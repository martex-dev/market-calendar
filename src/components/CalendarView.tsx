'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import DayList from './DayList';
import { useFilters } from './FilterContext';
import { TOPICS } from '@/lib/news/topics';
import type { TimeMode } from '@/lib/time';
import type { EventKind, Impact, MarketEvent } from '@/lib/types';

/**
 * The filtered calendar.
 *
 * Filtering happens in the browser rather than in SQL. The week and day views
 * load at most a few hundred rows, they are already in memory, and every page
 * here is `force-dynamic` — so a server round trip per keystroke would buy
 * nothing and cost a visible delay. The database keeps the query it was built
 * for ("everything in this range"), which is also the only one its index
 * covers.
 *
 * Days that filter down to nothing stay on screen as collapsed empty rows on
 * purpose. Removing them would make a filtered week look like a week with no
 * events in it, and the calendar's job is to show the shape of the week.
 */

/**
 * A rail topic constrains the calendar only when it names calendar rows.
 * 'Markets' and 'Trade' describe coverage that has no scheduled counterpart,
 * so those chips filter the rail and deliberately leave the calendar alone
 * rather than emptying it.
 */
function topicMatcher(topic: string | null): ((e: MarketEvent) => boolean) | null {
	if (!topic) return null;
	if (topic === 'earnings') return (e) => e.kind === 'earnings';

	const keys = TOPICS.find((t) => t.key === topic)?.eventKeys ?? [];
	if (keys.length === 0) return null;

	return (e) => keys.some((k) => e.id.endsWith(`:${k}`));
}

const KIND_LABEL: Record<EventKind, string> = {
	macro: 'Macro',
	earnings: 'Earnings',
};

const IMPACTS: Impact[] = ['High', 'Medium', 'Low'];

export default function CalendarView({
	days,
	events,
	mode,
	today,
	nav,
}: {
	days: string[];
	events: MarketEvent[];
	mode: TimeMode;
	today: string;
	nav: { prev: string; next: string; today: string; week: string; day: string };
}) {
	const router = useRouter();
	const { query, setQuery, kinds, toggleKind, impacts, toggleImpact, topic, active, reset } =
		useFilters();
	const searchRef = useRef<HTMLInputElement>(null);

	/* ------------------------------ shortcuts ------------------------------ */

	useEffect(() => {
		function onKey(ev: KeyboardEvent) {
			const el = ev.target as HTMLElement | null;
			const typing =
				el?.tagName === 'INPUT' ||
				el?.tagName === 'TEXTAREA' ||
				el?.isContentEditable;

			if (ev.key === 'Escape' && typing) {
				setQuery('');
				searchRef.current?.blur();
				return;
			}
			// Never steal a shortcut from a browser or OS chord.
			if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;

			switch (ev.key) {
				case '/':
					ev.preventDefault();
					searchRef.current?.focus();
					break;
				case 'ArrowLeft':
					router.push(nav.prev);
					break;
				case 'ArrowRight':
					router.push(nav.next);
					break;
				case 't':
					router.push(nav.today);
					break;
				case 'w':
					router.push(nav.week);
					break;
				case 'd':
					router.push(nav.day);
					break;
			}
		}

		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [router, nav, setQuery]);

	/* ------------------------------- filtering ----------------------------- */

	const byTopic = useMemo(() => topicMatcher(topic), [topic]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return events.filter((e) => {
			if (!kinds.has(e.kind)) return false;
			if (!impacts.has(e.impact)) return false;
			if (byTopic && !byTopic(e)) return false;
			if (q) {
				const hay = `${e.title} ${e.symbol ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}, [events, kinds, impacts, byTopic, query]);

	const byDate = useMemo(() => {
		const map = new Map<string, MarketEvent[]>();
		for (const d of days) map.set(d, []);
		for (const e of filtered) {
			if (!map.has(e.date)) map.set(e.date, []);
			map.get(e.date)!.push(e);
		}
		return map;
	}, [filtered, days]);

	const filtering = active || byTopic !== null;

	return (
		<>
			<div className='filters'>
				<div className='search'>
					<span className='search-icon' aria-hidden='true'>
						⌕
					</span>
					<input
						ref={searchRef}
						type='search'
						value={query}
						placeholder='Filter by name or ticker'
						aria-label='Filter events by name or ticker'
						onChange={(e) => setQuery(e.target.value)}
					/>
					<kbd className='mono'>/</kbd>
				</div>

				<div className='fset'>
					{(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
						<button
							type='button'
							key={k}
							className={`fchip kind-${k}${kinds.has(k) ? ' on' : ''}`}
							aria-pressed={kinds.has(k)}
							onClick={() => toggleKind(k)}
						>
							{KIND_LABEL[k]}
						</button>
					))}
				</div>

				<div className='fset'>
					{IMPACTS.map((i) => (
						<button
							type='button'
							key={i}
							className={`fchip imp-${i}${impacts.has(i) ? ' on' : ''}`}
							aria-pressed={impacts.has(i)}
							onClick={() => toggleImpact(i)}
						>
							{i}
						</button>
					))}
				</div>

				<div className='fcount mono' aria-live='polite'>
					{filtered.length}
					<span> / {events.length}</span>
					{filtering && (
						<button type='button' className='freset' onClick={reset}>
							clear
						</button>
					)}
				</div>
			</div>

			{filtering && filtered.length === 0 && (
				<p className='notice'>
					Nothing in this range matches the current filter. The days below are
					still listed so the shape of the week stays visible.
				</p>
			)}

			{days.map((d) => (
				<DayList
					key={d}
					date={d}
					events={byDate.get(d) ?? []}
					mode={mode}
					isToday={d === today}
				/>
			))}
		</>
	);
}
