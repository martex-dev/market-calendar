/**
 * Ties a headline back to the calendar.
 *
 * The point of putting news next to a schedule is not "here are some
 * headlines" — it is "this story is about a row you can see". So every item
 * gets tagged two ways:
 *
 *   TOPIC   keyword match onto the macro release families we track, which
 *           gives each headline a link to the actual dated rows for that
 *           release (CPI story -> the next CPI print).
 *   TICKER  company-name match against the earnings rows already loaded, so
 *           a story about Nvidia surfaces on the day Nvidia reports.
 *
 * Both are deliberately dumb string matching over a fixed table. There is no
 * model, no scoring, and nothing learned — the same rule CLAUDE.md applies to
 * impact tags. A match is either present or it is not, and a reader can check
 * it by eye.
 *
 * FALSE-POSITIVE POSTURE: patterns are anchored on word boundaries and the
 * ticker pass requires a distinctive core name of four characters or more.
 * Missing a link is fine; a wrong link is not, because the whole product is a
 * claim that lines are traceable.
 */

import type { MarketEvent } from '../types';

export interface Topic {
	key: string;
	label: string;
	/** Macro event keys (the `key` field in impact.ts) this topic covers. */
	eventKeys: string[];
	patterns: RegExp[];
}

export const TOPICS: Topic[] = [
	{
		key: 'fed',
		label: 'Fed',
		eventKeys: ['fomc-rate-decision'],
		patterns: [
			/\bfomc\b/i,
			/\bfederal reserve\b/i,
			/\bthe fed\b/i,
			/\bfed(?:'s|’s)\b/i,
			/\bfed (?:chair|official|speaker|minutes|policy)/i,
			/\brate (?:cut|hike|decision|path)/i,
			/\binterest rates?\b/i,
			/\bmonetary policy\b/i,
			/\bjackson hole\b/i,
		],
	},
	{
		key: 'inflation',
		label: 'Inflation',
		eventKeys: ['cpi', 'producer-price-index', 'personal-income-and-outlays'],
		patterns: [
			/\bcpi\b/i,
			/\bppi\b/i,
			/\bpce\b/i,
			/\binflation\b/i,
			/\bconsumer price/i,
			/\bproducer price/i,
			/\bcore prices?\b/i,
			/\bdisinflation\b/i,
		],
	},
	{
		key: 'jobs',
		label: 'Jobs',
		eventKeys: ['employment-situation', 'jobless-claims', 'jolts'],
		patterns: [
			/\bpayrolls?\b/i,
			/\bnonfarm\b/i,
			/\bjobless claims\b/i,
			/\bunemployment\b/i,
			/\bjob (?:market|openings|growth|cuts|losses)/i,
			/\blabor market\b/i,
			/\bhiring\b/i,
			/\blayoffs?\b/i,
			/\bjolts\b/i,
		],
	},
	{
		key: 'growth',
		label: 'Growth',
		eventKeys: ['gross-domestic-product'],
		patterns: [
			/\bgdp\b/i,
			/\bgross domestic product\b/i,
			/\brecession\b/i,
			/\beconomic growth\b/i,
			/\bcorporate profits\b/i,
		],
	},
	{
		key: 'consumer',
		label: 'Consumer',
		eventKeys: ['retail-sales'],
		patterns: [
			/\bretail sales\b/i,
			/\bconsumer spending\b/i,
			/\bconsumer (?:confidence|sentiment)\b/i,
			/\bpersonal income\b/i,
			/\bhousehold (?:budgets?|spending)\b/i,
		],
	},
	{
		key: 'earnings',
		label: 'Earnings',
		eventKeys: [],
		patterns: [
			/\bearnings\b/i,
			/\bquarterly results\b/i,
			/\bguidance\b/i,
			/\brevenue\b/i,
			/\bprofit (?:beat|miss|warning)/i,
			/\bq[1-4] (?:results|report)/i,
		],
	},
	{
		/*
		 * The catch-all for market-wide coverage that is not about one of the
		 * scheduled releases. It exists mainly as a RELEVANCE GATE: the two
		 * wires carry personal-finance columns and consumer-brand stories that
		 * have no business on a market calendar, and an item matching no topic
		 * and no ticker is dropped (see getMarketNews). Without this entry the
		 * gate would also throw away legitimate index and rates coverage.
		 */
		key: 'markets',
		label: 'Markets',
		eventKeys: [],
		patterns: [
			/\bs&p 500\b/i,
			/\bnasdaq\b/i,
			/\bdow (?:jones|industrials)?\b/i,
			// Plural only, plus the explicit compound. Singular "stock" leaks:
			// it matched a personal-finance column about a "stock certificate",
			// which is exactly the kind of item the gate exists to keep out.
			/\bstocks\b/i,
			/\bstock market\b/i,
			/\bequit(?:y|ies)\b/i,
			/\b(?:bull|bear) market\b/i,
			/\bsell-?off\b/i,
			/\brall(?:y|ied|ies)\b/i,
			/\btreasur(?:y|ies)\b/i,
			/\byields?\b/i,
			/\bbond market\b/i,
			/\bvolatility\b/i,
			/\bwall street\b/i,
			/\bthe dollar\b/i,
			/\bcrude\b/i,
		],
	},
	{
		key: 'trade',
		label: 'Trade',
		eventKeys: [],
		patterns: [
			/\btariffs?\b/i,
			/\btrade (?:deficit|war|gap|talks)\b/i,
			/\bimport prices\b/i,
			/\bsupply chain\b/i,
		],
	},
];

export function topicByKey(key: string): Topic | undefined {
	return TOPICS.find((t) => t.key === key);
}

/** Which topics a headline (plus its summary) touches. */
export function matchTopics(text: string): string[] {
	return TOPICS.filter((t) => t.patterns.some((p) => p.test(text))).map(
		(t) => t.key,
	);
}

/*
 * -------------------------- ticker name matching ---------------------------
 *
 * NASDAQ gives company names like "Cadence Design Systems, Inc." and
 * "Coca-Cola Company (The)". A headline says "Cadence" or "Coca-Cola". So we
 * reduce each name to a distinctive CORE — everything before the first legal
 * suffix — and match that.
 */

const LEGAL_SUFFIX =
	/\b(?:incorporated|inc|corporation|corp|company|co|holdings?|group|plc|ltd|limited|llc|lp|nv|sa|ag|the|class\s+[a-c]|common stock|&\s*co)\b\.?/gi;

/**
 * Words that are real company cores but also ordinary English, so matching
 * them on a wire headline produces nonsense ("Gap" in "the gap between",
 * "Match" in "match expectations"). Excluded outright rather than guessed at.
 */
const AMBIGUOUS_CORES = new Set([
	'gap',
	'match',
	'target',
	'visa',
	'block',
	'centene',
	'first',
	'general',
	'globe',
	'public',
	'union',
	'united',
	'american',
	'national',
	'international',
	'western',
	'southern',
	'northern',
	'eastern',
	'pool',
	'expand',
	'sysco',
	'nike',
	'apa',
	'bio',
	'edison',
	'host',
	'invitation',
	'principal',
	'progressive',
	'prudential',
	'republic',
	'resources',
	'revvity',
	'science',
	'services',
	'solutions',
	'systems',
	'technologies',
	'trust',
]);

export function companyCore(name: string): string | null {
	const core = name
		.replace(/\(.*?\)/g, ' ')
		.replace(LEGAL_SUFFIX, ' ')
		.replace(/[.,]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();

	if (core.length < 4) return null;
	if (AMBIGUOUS_CORES.has(core)) return null;
	return core;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the lookup once per request from whatever earnings rows are loaded,
 * rather than shipping a static ticker list that would go stale the moment an
 * index rebalances. Same reasoning as impactForMarketCap reading cap from the
 * live NASDAQ payload.
 */
export function buildCompanyIndex(
	events: MarketEvent[],
): { symbol: string; re: RegExp }[] {
	const seen = new Set<string>();
	const index: { symbol: string; re: RegExp }[] = [];

	for (const e of events) {
		if (e.kind !== 'earnings' || !e.symbol || seen.has(e.symbol)) continue;
		const core = companyCore(e.title);
		if (!core) continue;
		seen.add(e.symbol);
		index.push({
			symbol: e.symbol,
			re: new RegExp(`\\b${escapeRe(core)}\\b`, 'i'),
		});
	}

	return index;
}

export function matchSymbols(
	text: string,
	index: { symbol: string; re: RegExp }[],
): string[] {
	const hits = index.filter((c) => c.re.test(text)).map((c) => c.symbol);
	// Three is the display budget on a rail card; more than that and the
	// headline is a market wrap, not a story about a company.
	return hits.slice(0, 3);
}
