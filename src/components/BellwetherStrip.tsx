'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useFilters } from './FilterContext';
import { useNow } from '@/lib/client-hooks';
import { ET_ZONE, startOfWeek } from '@/lib/time';
import { bellwetherFor } from '@/lib/quotes/bellwethers';
import type { QuotesResult } from '@/lib/quotes';

/**
 * The quote board across the top — a forex terminal's "Majors" row, for
 * equities.
 *
 * Server-rendered with the page so prices are in the HTML, then refreshed on
 * a timer. It is the only genuinely live thing on the site: everything else
 * is a schedule, and a schedule that updates every minute would be a bug.
 *
 * The market-status pill reads NASDAQ's own `marketStatus` rather than
 * deriving a session from the clock. That closes a stated gap — the previous
 * clock arithmetic handled weekends but not market holidays, so it would have
 * read "open" on Thanksgiving. The exchange knows; we ask it.
 */

/** Slower than the 60s cache: polling faster would re-read the same entry. */
const POLL_MS = 60_000;

function statusClass(status: string | null): string {
	if (!status) return 'closed';
	const s = status.toLowerCase();
	if (s.includes('pre')) return 'pre';
	if (s.includes('after') || s.includes('extended')) return 'after';
	if (s.includes('open')) return 'open';
	return 'closed';
}

/** The ET wall clock, ticking. Null through SSR and hydration. */
function EtClock() {
	const now = useNow(1000);
	if (now === null) return <span className='bw-time mono' />;

	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: ET_ZONE,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).formatToParts(new Date(now));
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';

	return (
		<span className='bw-time mono'>
			{String(Number(get('hour')) % 24).padStart(2, '0')}:{get('minute')}:
			{get('second')} ET
		</span>
	);
}

export default function BellwetherStrip({
	initial,
	reportDates = {},
}: {
	initial: QuotesResult;
	/**
	 * Ticker -> the date it reports. Absent for the index tiles, and defaulted
	 * because a tile whose jump target is unknown must still render its price:
	 * the board's job is the quote, and the navigation is a convenience on top.
	 */
	reportDates?: Record<string, string>;
}) {
	const [data, setData] = useState<QuotesResult>(initial);
	const [busy, setBusy] = useState(false);
	const { query, setQuery } = useFilters();
	const inFlight = useRef(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const router = useRouter();
	const pathname = usePathname();

	/**
	 * Clicking a mega-cap filters the calendar to it and goes to the week it
	 * reports. Without the navigation the tile would usually filter the week
	 * in view down to zero rows — a company reports once a quarter, so almost
	 * every week is the wrong one.
	 */
	const jumpTo = useCallback(
		(symbol: string) => {
			if (query === symbol) {
				setQuery('');
				return;
			}
			setQuery(symbol);

			const date = reportDates[symbol];
			if (!date) return;

			const qs =
				new URLSearchParams(window.location.search).get('tz') === 'local'
					? '?tz=local'
					: '';
			router.push(
				pathname.startsWith('/day/')
					? `/day/${date}${qs}`
					: `/week/${startOfWeek(date)}${qs}`,
			);
		},
		[query, setQuery, reportDates, pathname, router],
	);

	const refresh = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		try {
			const res = await fetch('/api/quotes', { cache: 'no-store' });
			if (res.ok) {
				const next = (await res.json()) as QuotesResult;
				// Never replace a good board with an empty one: a transient
				// upstream failure should leave the last prices on screen.
				if (Array.isArray(next.quotes) && next.quotes.length > 0) {
					setData(next);
				}
			}
		} catch {
			// Same reasoning. A missed poll is not worth an error state.
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}, []);

	/*
	 * Publish the board's height so the sticky filter bar below can clear it.
	 *
	 * A hard-coded offset does not work: the board grows a line during
	 * pre/after-hours to carry the regular-session close, so it is 47px in
	 * regular hours and 66px outside them — and it changes underneath the
	 * reader at 09:30 and 16:00 without a reload. Measuring is the only way
	 * this stays right in every session and at every viewport width.
	 */
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;

		const apply = () =>
			document.documentElement.style.setProperty(
				'--board-h',
				`${el.offsetHeight}px`,
			);
		apply();

		const ro = new ResizeObserver(apply);
		ro.observe(el);
		return () => {
			ro.disconnect();
			document.documentElement.style.removeProperty('--board-h');
		};
	});

	useEffect(() => {
		const timer = setInterval(refresh, POLL_MS);
		// Timers are throttled in a hidden tab, so returning to one is exactly
		// when the board is most likely to be stale.
		const onVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [refresh]);

	if (data.quotes.length === 0) return null;

	const phase = statusClass(data.marketStatus);

	return (
		<div ref={rootRef} className={`bw phase-${phase}`}>
			<div className='bw-status'>
				<span className='bw-phase'>
					<i className='bw-beacon' />
					{data.marketStatus ?? 'Market'}
				</span>
				<EtClock />
			</div>

			<div className='bw-rail'>
				{data.quotes.map((q, i) => {
					const meta = bellwetherFor(q.symbol);
					const first = i > 0 && q.group !== data.quotes[i - 1].group;
					const active = query === q.symbol;
					const date = reportDates[q.symbol];

					/*
					 * Index tiles are not clickable. There is no "SPY" row on a
					 * calendar of macro releases and single-name earnings, so
					 * filtering to it could only ever empty the page. A control
					 * that is guaranteed to do nothing useful should not be a
					 * control.
					 */
					const interactive = q.group === 'megacap';

					const body = (
						<>
							<span className='bw-head'>
								<span className='bw-sym mono'>{q.symbol}</span>
								<span className='bw-label'>{q.label}</span>
							</span>
							<span className='bw-nums'>
								<span className='bw-price mono'>{q.price}</span>
								<span className='bw-pct mono'>{q.percent}</span>
							</span>
							{/*
							 * During pre/after-hours the headline figure is the
							 * extended-hours quote, so the regular-session move gets
							 * its own line. Two different numbers called "today"
							 * with no label is how a quote board misleads.
							 */}
							{q.session && phase !== 'open' && (
								<span className={`bw-session mono dir-${q.session.direction}`}>
									close {q.session.percent}
								</span>
							)}
						</>
					);

					const className = [
						'bw-tile',
						`dir-${q.direction}`,
						`grp-${q.group}`,
						first ? 'is-group-start' : '',
						active ? 'on' : '',
						interactive ? '' : 'is-static',
					]
						.filter(Boolean)
						.join(' ');

					const title = [
						meta?.rationale,
						q.asOf ? `Last: ${q.asOf}` : '',
						q.session ? `Regular session close: ${q.session.percent}` : '',
						q.realTime ? '' : 'Not real-time',
						interactive && date ? `Reports ${date} - click to go there` : '',
					]
						.filter(Boolean)
						.join('\n');

					return interactive ? (
						<button
							type='button'
							key={q.symbol}
							className={className}
							aria-pressed={active}
							title={title}
							onClick={() => jumpTo(q.symbol)}
						>
							{body}
						</button>
					) : (
						<div key={q.symbol} className={className} title={title}>
							{body}
						</div>
					);
				})}
			</div>

			<button
				type='button'
				className='bw-refresh mono'
				onClick={refresh}
				disabled={busy}
				aria-label='Refresh quotes'
				title={
					data.failed.length > 0
						? `Unavailable: ${data.failed.join(', ')}`
						: 'Refresh quotes'
				}
			>
				{busy ? '···' : '↻'}
			</button>
		</div>
	);
}
