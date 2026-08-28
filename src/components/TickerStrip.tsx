import TickerMarquee, { type TickerEntry } from './TickerMarquee';
import { getUpcomingHighImpact } from '@/lib/db/events';
import { getMarketNews } from '@/lib/news';
import {
	daysBetween,
	formatEventTime,
	relativeDays,
	timeAgo,
	todayET,
} from '@/lib/time';

/**
 * Builds the top rail and hands it to the client marquee.
 *
 * WHY IT CARRIES BOTH KINDS. The rail used to be upcoming High-impact events
 * only. Events answer "what is coming"; headlines answer "what just
 * happened". A strip with one and not the other is half a status line, and
 * the two interleave naturally because they are about the same releases —
 * the CPI row and the CPI story belong next to each other.
 *
 * Times are always ET, for the same reason the calendar defaults to it: the
 * market this describes runs on ET, so "08:30" has to keep meaning "the
 * release time" at a glance.
 *
 * Both legs fail independently. No database, no events; no feeds, no
 * headlines; neither takes down the rail or the page.
 */

/** Interleave two lists, alternating while both have entries. */
function weave<T>(a: T[], b: T[]): T[] {
	const out: T[] = [];
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if (i < a.length) out.push(a[i]);
		if (i < b.length) out.push(b[i]);
	}
	return out;
}

export default async function TickerStrip() {
	const today = todayET();

	const [eventsResult, newsResult] = await Promise.allSettled([
		getUpcomingHighImpact(today, 8),
		getMarketNews({ limit: 8 }),
	]);

	const events =
		eventsResult.status === 'fulfilled' ? eventsResult.value : [];
	const news =
		newsResult.status === 'fulfilled' ? newsResult.value.items : [];

	const eventEntries: TickerEntry[] = events.map((e) => ({
		id: `ev-${e.id}`,
		type: 'event',
		lead: e.date.slice(5).replace('-', '/'),
		text:
			e.etMinutes === null
				? e.title
				: `${e.title} · ${formatEventTime(e.date, e.etMinutes, 'ET').replace(' ET', '')}`,
		trail: relativeDays(daysBetween(today, e.date)),
		tone: 'high',
	}));

	const newsEntries: TickerEntry[] = news.slice(0, 8).map((n) => ({
		id: `nw-${n.id}`,
		type: 'news',
		lead: n.sourceLabel,
		text: n.title,
		trail: n.publishedAt ? timeAgo(n.publishedAt) : undefined,
		href: n.url,
	}));

	const entries = weave(eventEntries, newsEntries);
	if (entries.length === 0) return null;

	return <TickerMarquee entries={entries} />;
}
