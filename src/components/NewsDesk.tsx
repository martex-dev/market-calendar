'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useNews } from './NewsContext';
import { useFilters } from './FilterContext';
import { useNow } from '@/lib/client-hooks';
import { TOPICS } from '@/lib/news/topics';
import { rankNews } from '@/lib/news/rank';
import { startOfWeek, timeAgo } from '@/lib/time';

/**
 * The news desk: two windows above the calendar.
 *
 *   HOT STORY      one lead item, given room, with the reasons it leads.
 *   LATEST STORIES the newest, compact, filterable by topic.
 *
 * WHY THIS REPLACED THE SIDE RAIL. The rail put the same list in a 328px
 * column beside the calendar. Two panels across the top do the job better for
 * two reasons: the calendar gets its full width back, which matters for a
 * seven-column row grid; and separating "the one thing that matters" from
 * "everything that just landed" is a real editorial distinction that one
 * scrolling list cannot make. Everything the rail could do — topic chips,
 * ticker chips, source stamps, the jump to a company's earnings row — is here.
 *
 * The lead is chosen by src/lib/news/rank.ts and the panel prints that
 * reasoning. A "top story" you have to take on faith would be the only
 * unsourced claim on a page whose entire argument is that its claims are
 * sourced.
 */

/** Shared by both windows: what a source stamp and time label look like. */
function Meta({
	sourceLabel,
	tier,
	publishedAt,
	now,
}: {
	sourceLabel: string;
	tier: 'primary' | 'wire';
	publishedAt: string | null;
	now: number | null;
}) {
	return (
		<div className='nitem-meta'>
			<span className={`stamp mono src-news-${tier}`}>{sourceLabel}</span>
			{tier === 'primary' && (
				<span
					className='nitem-badge mono'
					title='Published by the agency that produces the data, not reported second-hand'
				>
					issuer
				</span>
			)}
			<span className='nitem-when mono'>
				{now !== null && publishedAt ? timeAgo(publishedAt, new Date(now)) : ''}
			</span>
		</div>
	);
}

export default function NewsDesk() {
	const news = useNews();
	const { topic, setTopic, setQuery, query } = useFilters();
	const router = useRouter();
	const pathname = usePathname();

	/*
	 * One 30s clock drives every "4m ago" in both windows. Minute-grained
	 * labels do not need a 1s tick, and the timestamps are absent from the
	 * server HTML because they are measured against the reader's clock, not
	 * the renderer's.
	 */
	const now = useNow(30_000);

	const items = useMemo(() => news?.items ?? [], [news]);

	/*
	 * The lead is scored against `fetchedAt`, NOT against the live clock.
	 *
	 * Recency decay means a Date.now() here would re-rank on every 30s tick
	 * and could silently swap the lead story out from under someone reading
	 * it. Pinning it to when the batch was fetched makes the lead stable until
	 * new data actually arrives, and keeps the server and client agreeing on
	 * which story leads.
	 */
	const ranked = useMemo(() => {
		const at = Date.parse(news?.fetchedAt ?? '');
		return rankNews(items, Number.isFinite(at) ? at : 0);
	}, [items, news?.fetchedAt]);

	const lead = ranked[0] ?? null;

	const latest = useMemo(() => {
		const pool = topic
			? items.filter((n) => n.topics.includes(topic))
			: items.filter((n) => n.id !== lead?.item.id);
		return pool.slice(0, 7);
	}, [items, topic, lead]);

	// Only offer chips for topics actually present — a filter that can only
	// ever return nothing is worse than no filter.
	const present = useMemo(() => {
		const counts = new Map<string, number>();
		for (const n of items) {
			for (const t of n.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		return TOPICS.filter((t) => counts.has(t.key)).map((t) => ({
			...t,
			count: counts.get(t.key)!,
		}));
	}, [items]);

	/**
	 * A ticker chip filters the calendar to that company AND navigates to the
	 * week it reports. The navigation is the important half: coverage of a
	 * print usually runs after it, so filtering the week in view would land on
	 * an empty calendar and the chip would look broken when it was working.
	 *
	 * `tz` is read from window.location inside the handler rather than with
	 * useSearchParams, which would opt this subtree out of static prerendering
	 * and fail the build on /_not-found.
	 */
	const jumpToSymbol = useCallback(
		(symbol: string) => {
			if (query === symbol) {
				setQuery('');
				return;
			}
			setQuery(symbol);

			const date = news?.symbolDates[symbol];
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
		[query, setQuery, news, pathname, router],
	);

	const tags = (topics: string[], symbols: string[]) =>
		topics.length + symbols.length === 0 ? null : (
			<div className='nitem-tags'>
				{topics.map((t) => (
					<button
						type='button'
						key={t}
						className={`ntag topic-${t}${topic === t ? ' on' : ''}`}
						onClick={() => setTopic(topic === t ? null : t)}
					>
						{TOPICS.find((x) => x.key === t)?.label ?? t}
					</button>
				))}
				{symbols.map((s) => (
					<button
						type='button'
						key={s}
						className={`ntag is-sym mono${query === s ? ' on' : ''}`}
						title={
							news?.symbolDates[s]
								? `Go to ${s} on ${news.symbolDates[s]}`
								: `Filter the calendar to ${s}`
						}
						onClick={() => jumpToSymbol(s)}
					>
						{s}
					</button>
				))}
			</div>
		);

	if (!news || items.length === 0) {
		return (
			<div className='desk'>
				<section className='win'>
					<div className='win-head'>
						<h2>News</h2>
					</div>
					<p className='win-empty'>
						No headlines available. All six feeds are public RSS with no key —
						if this stays empty, the network is blocked rather than a quota
						being spent.
					</p>
				</section>
			</div>
		);
	}

	return (
		<div className='desk'>
			{/* ------------------------------ hot story ----------------------- */}
			<section className='win win-hot'>
				<div className='win-head'>
					<h2>
						<span className='win-kicker'>News</span>
						Hot Story
					</h2>
					<span
						className='win-note mono'
						title='Scored by topic weight, whether the issuing agency published it, how many outlets are covering the subject, and how recent it is. See src/lib/news/rank.ts.'
					>
						why?
					</span>
				</div>

				{lead && (
					<article className={`hot tier-${lead.item.tier}`}>
						<Meta
							sourceLabel={lead.item.sourceLabel}
							tier={lead.item.tier}
							publishedAt={lead.item.publishedAt}
							now={now}
						/>

						<a
							className='hot-title'
							href={lead.item.url}
							target='_blank'
							rel='noopener noreferrer'
						>
							{lead.item.title}
						</a>

						{lead.item.summary && (
							<p className='hot-sum'>{lead.item.summary}</p>
						)}

						{lead.reasons.length > 0 && (
							<ul className='hot-why'>
								{lead.reasons.map((r) => (
									<li key={r}>{r}</li>
								))}
							</ul>
						)}

						{tags(lead.item.topics, lead.item.symbols)}
					</article>
				)}
			</section>

			{/* ---------------------------- latest stories -------------------- */}
			<section className='win win-latest'>
				<div className='win-head'>
					<h2>
						<span className='win-kicker'>News</span>
						Latest Stories
					</h2>
					<span
						className={`live${news.refreshing ? ' is-busy' : ''}`}
						title={
							news.live
								? 'Updated in place since the page loaded'
								: 'Rendered with the page; refreshes every 5 minutes'
						}
					>
						<i />
						Live
					</span>
					<button
						type='button'
						className='win-refresh mono'
						onClick={news.refresh}
						disabled={news.refreshing}
						aria-label='Refresh headlines'
					>
						{news.refreshing ? '···' : '↻'}
					</button>
				</div>

				<div className='win-topics'>
					<button
						type='button'
						className={`tchip${topic === null ? ' on' : ''}`}
						onClick={() => setTopic(null)}
					>
						All
						<span className='tchip-n mono'>{items.length}</span>
					</button>
					{present.map((t) => (
						<button
							type='button'
							key={t.key}
							className={`tchip topic-${t.key}${topic === t.key ? ' on' : ''}`}
							onClick={() => setTopic(topic === t.key ? null : t.key)}
							title={
								t.eventKeys.length > 0
									? 'Also filters the calendar to the matching releases'
									: undefined
							}
						>
							{t.label}
							<span className='tchip-n mono'>{t.count}</span>
						</button>
					))}
				</div>

				<ol className='win-list'>
					{latest.map((n) => (
						<li key={n.id} className={`nitem tier-${n.tier}`}>
							<Meta
								sourceLabel={n.sourceLabel}
								tier={n.tier}
								publishedAt={n.publishedAt}
								now={now}
							/>
							<a
								className='nitem-title'
								href={n.url}
								target='_blank'
								rel='noopener noreferrer'
							>
								{n.title}
							</a>
							{tags(n.topics, n.symbols)}
						</li>
					))}
				</ol>

				{latest.length === 0 && (
					<p className='win-empty'>
						Nothing tagged with that topic in the current window.
					</p>
				)}

				<p className='win-foot'>
					Six public RSS feeds — the Federal Reserve, BEA and Census directly,
					plus CNBC and MarketWatch. Wire items are kept only when they match a
					tracked release or a company reporting in this window.
					{news.failed.length > 0 && (
						<>
							{' '}
							<span className='win-warn'>
								Unreachable: {news.failed.map((f) => f.source).join(', ')}.
							</span>
						</>
					)}
				</p>
			</section>
		</div>
	);
}
