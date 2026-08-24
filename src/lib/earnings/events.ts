/**
 * Shapes NASDAQ earnings rows into MarketEvents, filtered to index
 * constituents.
 */

import { addDays, dayOfWeek } from '../time';
import { impactForMarketCap } from '../impact';
import { buildEventId, type MarketEvent, type Session } from '../types';
import {
	fetchEarningsForDate,
	parseMoney,
	type NasdaqEarningsRow,
} from './nasdaq';
import { normaliseSymbol, type ConstituentResult } from './constituents';

/**
 * NASDAQ returns one calendar day per request, so our 120-day window is ~85
 * weekday requests.
 *
 * Measured 2026-08-25 from Node: 85 requests, 1.9s wall clock, 0 failures at
 * this concurrency. That is far faster than issuing them from curl (~1.2-3.2s
 * each) because undici reuses the TLS connection across requests — the
 * per-request cost warm is ~130ms, not seconds. Keeping the bound at six
 * anyway: it is already comfortably inside Vercel's 60s ceiling, and this is
 * an undocumented endpoint with no published rate limit, so there is nothing
 * to gain from being greedier.
 */
const CONCURRENCY = 6;

/** NASDAQ's coarse timing buckets -> our Session, plus a display time. */
function mapSession(raw: string): { session: Session; etMinutes: number | null } {
	switch (raw) {
		case 'time-pre-market':
			// Pre-market reporters almost universally release before the 09:30
			// ET open; NASDAQ gives no exact time, so we tag the bucket and use
			// a conventional 07:00 ET for ordering within the day.
			return { session: 'premarket', etMinutes: 7 * 60 };
		case 'time-after-hours':
			// After the 16:00 ET close.
			return { session: 'afterhours', etMinutes: 16 * 60 + 15 };
		default:
			// 'time-not-supplied' and anything unrecognised. We show a dash
			// rather than inventing a time.
			return { session: 'unspecified', etMinutes: null };
	}
}

/**
 * NASDAQ writes 'N/A' (and sometimes an empty string) into the EPS fields
 * when there is no consensus or no year-ago comparable. Rendering that as
 * "EPS N/A" is worse than rendering nothing, so both collapse to null and the
 * UI shows its usual em dash.
 */
function cleanEps(raw: string | null | undefined, suffix = ''): string | null {
	const v = raw?.trim();
	if (!v || v === 'N/A' || v === '$0.00') return null;
	return `EPS ${v}${suffix}`;
}

function toEvent(
	row: NasdaqEarningsRow,
	date: string,
): MarketEvent | null {
	const symbol = normaliseSymbol(row.symbol ?? '');
	if (!symbol) return null;

	const { session, etMinutes } = mapSession(row.time ?? '');
	const marketCap = parseMoney(row.marketCap);

	return {
		id: buildEventId('earnings', date, symbol),
		kind: 'earnings',
		date,
		etMinutes,
		session,
		// Company name only. The ticker lives in `symbol` and the UI renders it
		// as its own chip, so baking "(MDT)" into the title here would print it
		// twice on every row.
		title: row.name?.trim() || symbol,
		impact: impactForMarketCap(marketCap),
		symbol,
		// NASDAQ does supply a consensus EPS estimate, unlike FRED for macro.
		forecast: cleanEps(row.epsForecast),
		previous: cleanEps(row.lastYearEPS, ' (yr ago)'),
		source: 'nasdaq',
	};
}

/** Run tasks with a bounded number in flight. */
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;

	async function worker(): Promise<void> {
		for (;;) {
			const i = cursor++;
			if (i >= items.length) return;
			results[i] = await fn(items[i]);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}

export interface FetchEarningsResult {
	events: MarketEvent[];
	/** Dates whose fetch failed outright, so the caller can decide what to do. */
	failedDates: string[];
	/** Rows dropped because the ticker is not an index constituent. */
	filteredOut: number;
}

/**
 * Fetch earnings for every weekday in [start, end], keeping only S&P 500 and
 * Nasdaq-100 constituents.
 *
 * Weekends are skipped without a request — NASDAQ answers them with
 * `rows: null` anyway, so calling would just waste ~2s each.
 */
export async function fetchEarningsEvents(
	opts: { start: string; end: string },
	constituents: ConstituentResult,
): Promise<FetchEarningsResult> {
	const dates: string[] = [];
	for (let d = opts.start; d <= opts.end; d = addDays(d, 1)) {
		const dow = dayOfWeek(d);
		if (dow !== 0 && dow !== 6) dates.push(d);
	}

	const failedDates: string[] = [];
	let filteredOut = 0;

	const perDate = await mapLimit(dates, CONCURRENCY, async (date) => {
		try {
			const rows = await fetchEarningsForDate(date);
			const events: MarketEvent[] = [];
			for (const row of rows) {
				const symbol = normaliseSymbol(row.symbol ?? '');
				if (!constituents.symbols.has(symbol)) {
					filteredOut++;
					continue;
				}
				const ev = toEvent(row, date);
				if (ev) events.push(ev);
			}
			return events;
		} catch {
			// One bad day must not fail the whole refresh. The database keeps
			// whatever that date already had.
			failedDates.push(date);
			return [] as MarketEvent[];
		}
	});

	return { events: perDate.flat(), failedDates, filteredOut };
}
