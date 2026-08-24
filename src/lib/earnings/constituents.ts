/**
 * S&P 500 + Nasdaq-100 constituent lists.
 *
 * v1 covers index constituents only, never the full ~4,000-ticker market
 * (CLAUDE.md). This module produces the ticker allowlist that the earnings
 * calendar is filtered against.
 *
 * SOURCES — and why they differ:
 *
 *   S&P 500  -> Wikipedia, "List of S&P 500 companies", table#constituents.
 *               Verified 2026-08-25: 503 rows (503 not 500 because a few
 *               companies have two share classes in the index). Updated
 *               within hours of index changes, stable markup, no key needed.
 *
 *   Nasdaq-100 -> NASDAQ's own API, NOT Wikipedia.
 *               The plan was to take both from Wikipedia, but the Nasdaq-100
 *               article does not carry a components table any more — verified
 *               2026-08-25: its sections run History / Selection criteria /
 *               Performance / Record values, with no constituent list and no
 *               ticker symbols anywhere on the page. NASDAQ publishes the
 *               list itself at api.nasdaq.com/api/quote/list-type/nasdaq100
 *               (102 rows on the same date), which is the authoritative
 *               source anyway.
 *
 * Both fetches are cached to the database by the refresh job. A parse failure
 * must fall back to the last known-good list rather than emptying the
 * calendar — a scrape that silently returns zero tickers would filter out
 * every earnings row and look like "a quiet week".
 */

import * as cheerio from 'cheerio';
import { nasdaqGet } from './nasdaq';

const SP500_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

const WIKI_HEADERS: Record<string, string> = {
	// Wikipedia asks automated clients to identify themselves.
	'user-agent':
		'MarketCalendar/0.1 (personal project; contact via repository owner)',
	accept: 'text/html',
};

export class ConstituentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConstituentError';
	}
}

/**
 * Sanity floor for each list. If a scrape returns fewer rows than this the
 * page structure has changed and we should fail loudly instead of shipping a
 * truncated allowlist.
 */
const MIN_SP500 = 400;
const MIN_NDX = 80;

/** Normalise ticker punctuation: Wikipedia writes BRK.B, NASDAQ writes BRK/B. */
export function normaliseSymbol(raw: string): string {
	return raw.trim().toUpperCase().replace(/\//g, '.');
}

export async function fetchSp500Symbols(): Promise<string[]> {
	const res = await fetch(SP500_URL, {
		cache: 'no-store',
		headers: WIKI_HEADERS,
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		throw new ConstituentError(`Wikipedia S&P 500 page returned ${res.status}`);
	}

	const $ = cheerio.load(await res.text());
	const table = $('#constituents');
	if (table.length === 0) {
		throw new ConstituentError(
			'Wikipedia S&P 500 page has no table#constituents — markup changed.',
		);
	}

	const symbols: string[] = [];
	table.find('tbody tr').each((_, tr) => {
		// Column 0 is Symbol; header rows have no <td> and are skipped.
		const cell = $(tr).find('td').first().text().trim();
		if (cell) symbols.push(normaliseSymbol(cell));
	});

	if (symbols.length < MIN_SP500) {
		throw new ConstituentError(
			`Wikipedia S&P 500 parse yielded only ${symbols.length} symbols (expected >= ${MIN_SP500}) — markup likely changed.`,
		);
	}

	return symbols;
}

interface NasdaqIndexResponse {
	data: { data?: { rows?: { symbol: string }[] }; rows?: { symbol: string }[] } | null;
}

export async function fetchNasdaq100Symbols(): Promise<string[]> {
	const body = await nasdaqGet<NasdaqIndexResponse>(
		'quote/list-type/nasdaq100',
	);
	// NASDAQ nests this one level deeper than the earnings endpoint.
	const rows = body.data?.data?.rows ?? body.data?.rows ?? [];
	const symbols = rows
		.map((r) => normaliseSymbol(r.symbol ?? ''))
		.filter(Boolean);

	if (symbols.length < MIN_NDX) {
		throw new ConstituentError(
			`NASDAQ-100 fetch yielded only ${symbols.length} symbols (expected >= ${MIN_NDX}).`,
		);
	}

	return symbols;
}

export interface ConstituentResult {
	symbols: Set<string>;
	sp500Count: number;
	ndxCount: number;
	/** Non-fatal problems worth logging from the refresh job. */
	warnings: string[];
}

/**
 * Build the combined allowlist.
 *
 * If exactly one source fails we continue with the other and warn — half a
 * calendar beats none. If both fail we throw, so the refresh job can keep the
 * previous run's data instead of overwriting it with nothing.
 */
export async function fetchConstituents(): Promise<ConstituentResult> {
	const warnings: string[] = [];

	const [sp, ndx] = await Promise.allSettled([
		fetchSp500Symbols(),
		fetchNasdaq100Symbols(),
	]);

	const spSymbols = sp.status === 'fulfilled' ? sp.value : [];
	const ndxSymbols = ndx.status === 'fulfilled' ? ndx.value : [];

	if (sp.status === 'rejected') {
		warnings.push(`S&P 500 constituents failed: ${sp.reason}`);
	}
	if (ndx.status === 'rejected') {
		warnings.push(`Nasdaq-100 constituents failed: ${ndx.reason}`);
	}

	if (spSymbols.length === 0 && ndxSymbols.length === 0) {
		throw new ConstituentError(
			`Both constituent sources failed; refusing to build an empty allowlist. ${warnings.join(' | ')}`,
		);
	}

	return {
		symbols: new Set([...spSymbols, ...ndxSymbols]),
		sp500Count: spSymbols.length,
		ndxCount: ndxSymbols.length,
		warnings,
	};
}
