import BellwetherStrip from './BellwetherStrip';
import { getBellwetherQuotes, type QuotesResult } from '@/lib/quotes';
import { BELLWETHERS } from '@/lib/quotes/bellwethers';
import { buildReportDates } from '@/lib/earnings/reportDates';
import { getEventsInRange } from '@/lib/db/events';
import { addDays, todayET } from '@/lib/time';

/**
 * Server half of the quote board: fetch once for the first paint, then hand
 * over to the client component's timer.
 *
 * It also resolves when each mega-cap next reports, so a tile can jump you to
 * its row instead of filtering the week you happen to be looking at down to
 * nothing. Same lookup the headline ticker chips use, from the same helper,
 * because two surfaces answering "when does NVDA report" differently would be
 * a bug waiting to happen.
 *
 * Cannot throw. The strip is the most fragile thing on the page — it depends
 * on an undocumented endpoint being up right now, not on a nightly job having
 * succeeded — so a failure here renders nothing and leaves the calendar
 * untouched.
 */
export default async function BellwetherBar() {
	let quotes: QuotesResult;
	try {
		quotes = await getBellwetherQuotes();
	} catch {
		return null;
	}

	if (quotes.quotes.length === 0) return null;

	/*
	 * The FULL loaded window, not the narrower one the news tagger uses.
	 *
	 * These eleven names report once a quarter, so a 52-day lookup misses most
	 * of them most of the time — MSFT reporting in late October is invisible
	 * from late August, and its tile silently degrades to a filter that finds
	 * nothing. The bounds mirror WINDOW_BACK_DAYS / WINDOW_FORWARD_DAYS in
	 * src/lib/refresh.ts, which is everything the database holds; keep them in
	 * step. Same indexed date-range query, just wider.
	 */
	const today = todayET();
	const events = await getEventsInRange(
		addDays(today, -30),
		addDays(today, 90),
	).catch(() => []);

	const reportDates = buildReportDates(
		events,
		new Set(BELLWETHERS.map((b) => b.symbol)),
		today,
	);

	return <BellwetherStrip initial={quotes} reportDates={reportDates} />;
}
