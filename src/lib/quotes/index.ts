/**
 * Live quotes for the Bellwethers strip.
 *
 * SOURCE. api.nasdaq.com/api/quote/{symbol}/info, reached through the shared
 * client in src/lib/earnings/nasdaq.ts. Choosing NASDAQ over the alternatives
 * was not a coin flip:
 *   - Yahoo's v7 quote endpoint now returns 401 without a crumb; its v8 chart
 *     endpoint works but is one request per symbol for a whole OHLC series we
 *     would throw away.
 *   - Stooq's CSV endpoint 404s on index symbols and is end-of-day anyway.
 *   - NASDAQ returns real-time last sale, both sessions, and the exchange's
 *     own market status, in one small JSON per symbol — and this codebase
 *     already talks to that host for the earnings calendar, so it is one
 *     dependency rather than two.
 *
 * WHY IT REUSES nasdaqGet RATHER THAN FETCHING DIRECTLY. This module was first
 * written with its own fetch and its own User-Agent. It worked for minutes and
 * then every request began hanging until it timed out — which is exactly the
 * transport-level failure nasdaq.ts warns about in its BROWSER_HEADERS note.
 * The shared client is the only place that knows what NASDAQ demands, so it is
 * the only place allowed to ask it.
 *
 * DELIBERATELY NOT IN THE DATABASE. Everything else here is written once a day
 * by cron because release dates do not change minute to minute (CLAUDE.md).
 * A price does. Quotes are fetched on the request path with a short cache and
 * refreshed by the client, exactly like the news leg and for the same reason.
 */

import { nasdaqGet } from '../earnings/nasdaq';
import { BELLWETHERS, type Bellwether } from './bellwethers';

export const QUOTE_REVALIDATE_SECONDS = 60;

/**
 * The session a quote belongs to, straight from the exchange.
 *
 * This replaces the clock arithmetic the ticker used to do. NASDAQ knows about
 * market holidays and we do not — the old heuristic would have read "open" on
 * Thanksgiving, which was a stated gap and is now closed by asking the source
 * instead of guessing.
 */
export type MarketStatus = string;

export interface Quote {
	symbol: string;
	label: string;
	group: Bellwether['group'];
	/** Formatted for display, e.g. "$769.78" or "26,541.35". */
	price: string;
	/** Signed absolute change, e.g. "-1.30". */
	change: string;
	/** Signed percent, e.g. "-0.17%". */
	percent: string;
	/** Numeric percent, for colouring and for sorting movers. Null if unparsed. */
	percentValue: number | null;
	direction: 'up' | 'down' | 'flat';
	/** True when the headline figure is a live trade rather than a stale close. */
	realTime: boolean;
	/** e.g. "Aug 27, 2026 7:59 PM ET". */
	asOf: string;
	/**
	 * The regular-session close, when the headline quote is an extended-hours
	 * one. During pre/after-hours NASDAQ puts the live extended quote in
	 * primaryData and the 4pm close in secondaryData, so this is "what the
	 * stock did today" while `percent` is "what it is doing right now".
	 */
	session: { percent: string; direction: 'up' | 'down' | 'flat' } | null;
}

export interface QuotesResult {
	quotes: Quote[];
	/** Exchange status: "Open", "After-Hours", "Closed", "Pre-Market"… */
	marketStatus: MarketStatus | null;
	failed: string[];
	fetchedAt: string;
}

/* ---------------------------- response shapes ---------------------------- */

interface NasdaqQuoteBlock {
	lastSalePrice?: string;
	netChange?: string;
	percentageChange?: string;
	deltaIndicator?: string;
	lastTradeTimestamp?: string;
	isRealTime?: boolean;
}

interface NasdaqQuoteResponse {
	data?: {
		symbol?: string;
		companyName?: string;
		marketStatus?: string;
		primaryData?: NasdaqQuoteBlock;
		secondaryData?: NasdaqQuoteBlock | null;
	} | null;
	status?: { rCode?: number };
}

function toDirection(raw: string | undefined): 'up' | 'down' | 'flat' {
	if (raw === 'up') return 'up';
	if (raw === 'down') return 'down';
	return 'flat';
}

/** "-0.17%" -> -0.17. Returns null rather than 0 so "unknown" stays visible. */
function toPercentValue(raw: string | undefined): number | null {
	if (!raw) return null;
	const n = Number(raw.replace(/[%,+\s]/g, ''));
	return Number.isFinite(n) ? n : null;
}

/**
 * One quote.
 *
 * maxAttempts is 1, unlike the nightly refresh's 3. This runs while somebody
 * is waiting for a page: a symbol that does not answer in five seconds should
 * drop off the strip, not hold the render open through two backoffs.
 */
function fetchOne(b: Bellwether): Promise<NasdaqQuoteResponse> {
	return nasdaqGet<NasdaqQuoteResponse>(
		`quote/${encodeURIComponent(b.symbol)}/info`,
		{ assetclass: b.assetClass },
		{
			revalidateSeconds: QUOTE_REVALIDATE_SECONDS,
			timeoutMs: 5000,
			maxAttempts: 1,
		},
	);
}

/**
 * Fetch the whole strip.
 *
 * All eleven go out at once. Measured 2026-08-28: 12 symbols, 412ms wall
 * clock, zero failures — undici reuses the connection, so the marginal cost
 * per symbol is tens of milliseconds. That is well inside the budget for a
 * request-path fetch, and there is no published rate limit to be polite to
 * beyond not hammering it, which the 60-second cache handles.
 *
 * A symbol that fails is dropped and named. The strip renders with ten tiles
 * rather than none — same degrade-do-not-wipe rule as the refresh job.
 */
export async function getBellwetherQuotes(): Promise<QuotesResult> {
	const settled = await Promise.allSettled(
		BELLWETHERS.map(async (b) => {
			const body = await fetchOne(b);
			const data = body?.data;
			const primary = data?.primaryData;

			// NASDAQ answers an unknown symbol with HTTP 200 and an error body,
			// so a successful response is not a successful lookup.
			if (!data || !primary?.lastSalePrice) {
				throw new Error(`no quote for ${b.symbol}`);
			}

			const secondary = data.secondaryData;

			const quote: Quote = {
				symbol: b.symbol,
				label: b.label,
				group: b.group,
				price: primary.lastSalePrice,
				change: primary.netChange ?? '',
				percent: primary.percentageChange ?? '',
				percentValue: toPercentValue(primary.percentageChange),
				direction: toDirection(primary.deltaIndicator),
				realTime: primary.isRealTime === true,
				asOf: primary.lastTradeTimestamp ?? '',
				session:
					secondary?.percentageChange
						? {
								percent: secondary.percentageChange,
								direction: toDirection(secondary.deltaIndicator),
							}
						: null,
			};

			return { quote, marketStatus: data.marketStatus ?? null };
		}),
	);

	const quotes: Quote[] = [];
	const failed: string[] = [];
	let marketStatus: string | null = null;

	settled.forEach((res, i) => {
		if (res.status === 'rejected') {
			failed.push(BELLWETHERS[i].symbol);
			return;
		}
		quotes.push(res.value.quote);
		// Every symbol reports the same status; first one wins.
		if (!marketStatus) marketStatus = res.value.marketStatus;
	});

	return {
		quotes,
		marketStatus,
		failed,
		fetchedAt: new Date().toISOString(),
	};
}
