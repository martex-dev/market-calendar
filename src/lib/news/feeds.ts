/**
 * The curated news feed list.
 *
 * Same discipline as src/lib/impact.ts: this is a fixed, hand-assembled table
 * with a stated reason per entry, kept apart from the fetching code so the
 * editorial choice can be reviewed without reading a parser.
 *
 * SELECTION RULE. Every feed here is either (a) the agency that publishes the
 * numbers this calendar schedules, or (b) a wire that covers those numbers.
 * Nothing else. A general business feed would fill the rail with M&A and
 * product launches, which have nothing to do with the calendar.
 *
 * All six are public RSS over HTTPS with no key, no quota, and no signup —
 * the same constraint that shaped the FRED/NASDAQ choice.
 *
 * TIERS. `primary` is the issuing agency speaking for itself; `wire` is
 * journalism about it. The UI stamps them differently, because "the Fed
 * published minutes" and "a reporter says the Fed will cut" are not the same
 * class of claim and the product's whole posture is to say where a line came
 * from.
 */

export type FeedTier = 'primary' | 'wire';

export interface NewsFeed {
	/** Stable key. Also the DB/display identity. */
	key: string;
	/** Short stamp label, matching the row stamps on the calendar. */
	label: string;
	tier: FeedTier;
	url: string;
	/** Why this feed is in the list. */
	rationale: string;
}

export const NEWS_FEEDS: NewsFeed[] = [
	{
		key: 'federalreserve',
		label: 'FED',
		tier: 'primary',
		url: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
		rationale:
			'The monetary-policy press release feed — FOMC statements, minutes, and implementation notes. This is the primary text behind the single highest-impact row on the calendar, straight from the issuer.',
	},
	{
		key: 'bea',
		label: 'BEA',
		tier: 'primary',
		url: 'https://apps.bea.gov/rss/rss.xml',
		rationale:
			'Bureau of Economic Analysis releases. BEA publishes GDP and the PCE price index, i.e. two of the four High-impact macro rows, and its RSS description carries the actual print — so a headline here often IS the number.',
	},
	{
		key: 'census',
		label: 'CENSUS',
		tier: 'primary',
		url: 'https://www.census.gov/economic-indicators/indicator.xml',
		rationale:
			'Census economic-indicator briefing room: retail sales, trade, inventories, durable goods. Same rationale as BEA — the description field contains the released figure and its revision.',
	},
	{
		key: 'cnbc-economy',
		label: 'CNBC ECON',
		tier: 'wire',
		url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
		rationale:
			'CNBC Economy. Fed speakers, inflation reaction, policy expectations — the interpretation layer the agency feeds deliberately do not have.',
	},
	{
		key: 'cnbc-finance',
		label: 'CNBC FIN',
		tier: 'wire',
		url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',
		rationale:
			'CNBC Finance. Carries the market reaction and the single-name earnings coverage that pairs with the earnings half of the calendar.',
	},
	{
		key: 'marketwatch',
		label: 'MARKETWATCH',
		tier: 'wire',
		url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
		rationale:
			'MarketWatch Top Stories, for a second wire so no single outlet frames the rail. NOTE: their MarketPulse feed looks like the better fit by name but is stale — checked 2026-08-28, newest item was from July 2025. Top Stories is current.',
	},
];

export function feedByKey(key: string): NewsFeed | undefined {
	return NEWS_FEEDS.find((f) => f.key === key);
}
