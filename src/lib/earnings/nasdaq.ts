/**
 * NASDAQ earnings-calendar client.
 *
 * Approach follows the open-source `s-kerin/finance_calendars` wrapper (MIT):
 * hit NASDAQ's public JSON calendar API rather than scraping their HTML.
 *
 *   https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
 *
 * Per CLAUDE.md this module must stay independent of the FRED client. It
 * shares only src/lib/types.ts with it.
 *
 * CAVEAT WORTH KNOWING: this is an undocumented internal API — it is what
 * nasdaq.com itself calls. There is no published rate limit, no terms of use
 * covering programmatic access, and no stability guarantee. Measured latency
 * is ~1.2-3.2s per request and it returns one calendar DAY per request.
 * Consequences we design around:
 *   - every response is cached to our own database, so a NASDAQ outage
 *     degrades to stale data rather than an empty calendar
 *   - requests are concurrency-limited, not fired all at once
 *   - a browser-like User-Agent is REQUIRED (see below)
 */

const NASDAQ_BASE = 'https://api.nasdaq.com/api';

/**
 * NASDAQ refuses connections outright without a browser-like User-Agent —
 * verified: with curl's default UA the connection fails at the transport
 * level (no HTTP status at all), not with a 403. This header is load-bearing,
 * not decoration. Do not remove it.
 *
 * Re-verified 2026-08-28, the hard way. The quotes client was written with its
 * own polite agent ('Mozilla/5.0 (compatible; MarketCalendar/1.0; +url)') and
 * worked for a few minutes before every request began hanging until it timed
 * out, while this exact header answered the same endpoint in 190ms. A
 * "compatible"-style token is not enough; it wants a real browser UA. That is
 * why every api.nasdaq.com call in this codebase goes through this one
 * function instead of each caller rolling its own headers.
 */
const BROWSER_HEADERS: Record<string, string> = {
	'user-agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
	accept: 'application/json, text/plain, */*',
	'accept-language': 'en-US,en;q=0.9',
};

export class NasdaqError extends Error {
	// See the note in src/lib/fred/client.ts: no TS parameter properties.
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'NasdaqError';
		this.status = status;
	}
}

export interface NasdaqGetOptions {
	/**
	 * Seconds to keep the response in Next's Data Cache.
	 *
	 * Omitted for the refresh job, which owns caching via our own database and
	 * must never read a stale fetch layer. Set by the quotes client, which runs
	 * on the request path and does want a short shared cache.
	 */
	revalidateSeconds?: number;
	/** Default 20s, which suits the slow calendar endpoint. */
	timeoutMs?: number;
	/** Default 3. Set to 1 on the request path, where a retry storm costs
	 *  the viewer latency they can see. */
	maxAttempts?: number;
}

/** Shared low-level GET for every api.nasdaq.com call. */
export async function nasdaqGet<T>(
	path: string,
	params: Record<string, string> = {},
	options: NasdaqGetOptions = {},
	attempt = 1,
): Promise<T> {
	const url = new URL(`${NASDAQ_BASE}/${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

	const maxAttempts = options.maxAttempts ?? 3;

	let res: Response;
	try {
		res = await fetch(url, {
			...(options.revalidateSeconds === undefined
				? { cache: 'no-store' as const }
				: { next: { revalidate: options.revalidateSeconds } }),
			headers: BROWSER_HEADERS,
			signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
		});
	} catch (err) {
		// Transport-level failure, which is also how a missing UA presents.
		if (attempt < maxAttempts) {
			await sleep(attempt * 750);
			return nasdaqGet<T>(path, params, options, attempt + 1);
		}
		throw new NasdaqError(
			`NASDAQ request failed after ${attempt} attempts: ${String(err)}`,
			0,
		);
	}

	if (res.status === 429 || res.status >= 500) {
		if (attempt < maxAttempts) {
			await sleep(attempt * 1500);
			return nasdaqGet<T>(path, params, options, attempt + 1);
		}
		throw new NasdaqError(`NASDAQ returned ${res.status}`, res.status);
	}

	if (!res.ok) throw new NasdaqError(`NASDAQ returned ${res.status}`, res.status);

	return (await res.json()) as T;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/* ----------------------------- Response shapes ---------------------------- */

/** One row of the earnings calendar, as NASDAQ returns it. */
export interface NasdaqEarningsRow {
	symbol: string;
	name: string;
	/**
	 * 'time-pre-market' | 'time-after-hours' | 'time-not-supplied'
	 *
	 * NASDAQ only populates this for upcoming dates. For dates in the past it
	 * returns 'time-not-supplied' for every row — verified 2026-08-25, where
	 * all 284 rows on 2026-07-29 came back unsupplied while 2026-08-26 and
	 * 2026-09-03 had a normal pre-market/after-hours split. So historical rows
	 * legitimately have no time; that is the source, not our mapping.
	 */
	time: string;
	/** Formatted with a currency symbol and separators, e.g. '$122,927,344,726'. */
	marketCap: string;
	/** e.g. '$2.71', or '' when no consensus exists. */
	epsForecast: string;
	noOfEsts: string;
	fiscalQuarterEnding: string;
	lastYearRptDt: string;
	lastYearEPS: string;
}

interface NasdaqEarningsResponse {
	data: {
		asOf: string | null;
		headers: Record<string, string> | null;
		/** null on weekends/holidays — not an error. */
		rows: NasdaqEarningsRow[] | null;
	} | null;
	status: { rCode: number; bCodeMessage: string | null };
}

/**
 * Fetch the raw earnings rows for one calendar date.
 *
 * Returns [] for weekends and holidays: NASDAQ answers 200 with `rows: null`,
 * which is a legitimate "nothing scheduled", not a failure.
 */
export async function fetchEarningsForDate(
	date: string,
): Promise<NasdaqEarningsRow[]> {
	const body = await nasdaqGet<NasdaqEarningsResponse>('calendar/earnings', {
		date,
	});
	return body.data?.rows ?? [];
}

/**
 * Parse NASDAQ's formatted money strings ('$122,927,344,726') to a number.
 * Returns null for '', 'N/A', or anything unparseable — callers must handle
 * null rather than getting a silent 0, which would mis-tag impact.
 */
export function parseMoney(raw: string | null | undefined): number | null {
	if (!raw) return null;
	const cleaned = raw.replace(/[$,\s]/g, '');
	if (!cleaned || cleaned === 'N/A') return null;
	const n = Number(cleaned);
	return Number.isFinite(n) ? n : null;
}
