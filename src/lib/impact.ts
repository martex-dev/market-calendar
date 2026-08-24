/**
 * Impact lookup table.
 *
 * Kept in its own file (per CLAUDE.md) so the classifications can be reviewed
 * and edited without touching any fetching code. Nothing here is computed at
 * runtime from market behaviour — these are fixed, hand-assigned tags per
 * event TYPE, which is the explicit v1 requirement.
 *
 * Assignment rule, from CLAUDE.md: "Base impact tags on which events
 * historically move markets most (FOMC, CPI, NFP, GDP = High; most others =
 * Medium/Low)." Each entry below cites why it landed where it did.
 */

import type { Impact, Session } from './types';

export interface MacroEventType {
	/** Our internal key. Also the DB identity component. */
	key: string;
	/** Display name shown in the calendar. */
	title: string;
	impact: Impact;
	/**
	 * Scheduled release time in ET, as minutes past midnight.
	 *
	 * FRED's releases/dates endpoint returns DATES ONLY — it carries no clock
	 * time. These times are the long-standing publication conventions of the
	 * issuing agency and are hand-maintained here, cited per entry.
	 */
	etMinutes: number;
	session: Session;
	/** Why this impact level — required, see CLAUDE.md. */
	rationale: string;
}

const HH = (h: number, m: number) => h * 60 + m;

/**
 * The curated macro release list. This is intentionally a fixed set, NOT
 * "all FRED releases" — see CLAUDE.md's v1 scope.
 *
 * `fredReleaseName` is matched case-insensitively against FRED release names
 * at fetch time (see src/lib/fred/releases.ts). We resolve FRED's numeric
 * release ids from the API rather than hardcoding ids that could drift.
 *
 * NOTE ON ISM: CLAUDE.md lists ISM Manufacturing and Services PMI. They are
 * NOT obtainable from FRED. The Institute for Supply Management required the
 * St. Louis Fed to remove all 22 ISM series on 2016-06-24, so there is no
 * free FRED path to them:
 *   https://news.research.stlouisfed.org/2016/06/institute-for-supply-management-data-to-be-removed-from-fred/
 * Decision (2026-08-25): dropped from v1 rather than adding a second
 * hand-maintained schedule. This is a known, deliberate coverage gap.
 */
export interface MacroReleaseType extends MacroEventType {
	/** Exact FRED release name, used to resolve the numeric release id. */
	fredReleaseName: string;
	/**
	 * FRED series id used to look up the previous period's actual value.
	 * Null means we show no "previous" for this release.
	 */
	previousSeriesId: string | null;
	/**
	 * FRED `units` transformation to apply to that series.
	 *
	 * This matters more than it looks. Most of these series are published as
	 * INDEX LEVELS or STOCK TOTALS, which is not what a calendar shows: the
	 * CPI row should read "2.7%", not the index level 332.813, and the payrolls
	 * row should read "+150K" (the monthly change), not 158,858K (total US
	 * employment). Asking FRED to transform is exact and free — computing it
	 * ourselves from two observations would just reimplement it worse.
	 *
	 *   lin = as published        chg = change from previous period
	 *   pch = % change period     pc1 = % change from a year ago
	 *   pca = % change, annualised
	 */
	previousUnits: 'lin' | 'chg' | 'pch' | 'pc1' | 'pca';
	/** Display suffix, e.g. '%' or 'K'. Must match what previousUnits yields. */
	previousSuffix: string;
}

export const MACRO_RELEASE_TYPES: MacroReleaseType[] = [
	{
		key: 'cpi',
		fredReleaseName: 'Consumer Price Index',
		title: 'Consumer Price Index (CPI)',
		impact: 'High',
		etMinutes: HH(8, 30),
		session: 'premarket',
		previousSeriesId: 'CPIAUCSL',
		// Headline CPI year-over-year — the number quoted as "inflation".
		previousUnits: 'pc1',
		previousSuffix: '% y/y',
		rationale:
			'Named High in CLAUDE.md. Headline inflation print; directly drives rate expectations. BLS publishes at 08:30 ET (bls.gov/schedule/news_release/cpi.htm).',
	},
	{
		key: 'employment-situation',
		fredReleaseName: 'Employment Situation',
		title: 'Employment Situation (Nonfarm Payrolls)',
		impact: 'High',
		etMinutes: HH(8, 30),
		session: 'premarket',
		previousSeriesId: 'PAYEMS',
		// PAYEMS is a LEVEL in thousands; the market watches the monthly
		// CHANGE, so transform to chg and the units stay thousands.
		previousUnits: 'chg',
		previousSuffix: 'K',
		rationale:
			'Named High in CLAUDE.md. The monthly NFP/unemployment print; one half of the Federal Reserve dual mandate. BLS publishes at 08:30 ET.',
	},
	{
		key: 'gross-domestic-product',
		fredReleaseName: 'Gross Domestic Product',
		title: 'Gross Domestic Product (GDP)',
		impact: 'High',
		etMinutes: HH(8, 30),
		session: 'premarket',
		previousSeriesId: 'GDPC1',
		// GDP is reported as an annualised quarterly growth rate, not a level.
		previousUnits: 'pca',
		previousSuffix: '% q/q ann.',
		rationale:
			'Named High in CLAUDE.md. Broadest measure of output; the advance estimate is the market-moving one. BEA publishes at 08:30 ET (bea.gov/news/schedule).',
	},
	{
		key: 'personal-income-and-outlays',
		fredReleaseName: 'Personal Income and Outlays',
		title: 'Personal Income & Outlays (PCE)',
		impact: 'High',
		etMinutes: HH(8, 30),
		session: 'premarket',
		previousSeriesId: 'PCEPILFE',
		// Core PCE price index, year-over-year — the Fed's 2% target measure.
		previousUnits: 'pc1',
		previousSuffix: '% y/y',
		rationale:
			'High. A slight extension beyond the four examples CLAUDE.md names: core PCE is the FOMC explicitly stated preferred inflation gauge for its 2 percent objective (federalreserve.gov, "Why does the FOMC target 2 percent inflation?"), so it moves rate expectations comparably to CPI. Downgrade to Medium here if you disagree.',
	},
	{
		key: 'producer-price-index',
		fredReleaseName: 'Producer Price Index',
		title: 'Producer Price Index (PPI)',
		impact: 'Medium',
		etMinutes: HH(8, 30),
		session: 'premarket',
		// PPIFIS = PPI for Final Demand, which is the headline number BLS
		// leads with and the market reacts to. PPIACO (all commodities) is a
		// different, much more volatile index — it read 8.3% y/y on the same
		// date PPIFIS read 4.7%, so the choice of series is not cosmetic.
		previousSeriesId: 'PPIFIS',
		previousUnits: 'pc1',
		previousSuffix: '% y/y',
		rationale:
			'Medium. Inflation data, but upstream of CPI and largely treated as a read-through to the PCE components rather than a standalone driver. BLS, 08:30 ET.',
	},
	{
		key: 'retail-sales',
		fredReleaseName: 'Advance Monthly Sales for Retail and Food Services',
		title: 'Retail Sales',
		impact: 'Medium',
		etMinutes: HH(8, 30),
		session: 'premarket',
		previousSeriesId: 'RSAFS',
		// Retail sales are quoted as the month-over-month percent change.
		previousUnits: 'pch',
		previousSuffix: '% m/m',
		rationale:
			'Medium. Primary consumer-demand indicator and a real mover on surprises, but not a direct policy input the way CPI or NFP are. Census Bureau, 08:30 ET (census.gov/retail).',
	},
	{
		key: 'jobless-claims',
		fredReleaseName: 'Unemployment Insurance Weekly Claims Report',
		title: 'Initial Jobless Claims',
		impact: 'Medium',
		etMinutes: HH(8, 30),
		session: 'premarket',
		previousSeriesId: 'ICSA',
		// ICSA is already a count of PERSONS, not thousands. The previous 'K'
		// suffix here rendered 206,000 claims as "206,000K" — 206 million.
		previousUnits: 'lin',
		previousSuffix: '',
		rationale:
			'Medium. The highest-frequency labour signal available and closely watched at inflection points, but the weekly cadence and its noise mean any single print rarely moves the index. DOL, Thursdays 08:30 ET.',
	},
	{
		key: 'jolts',
		fredReleaseName: 'Job Openings and Labor Turnover Survey',
		title: 'JOLTS Job Openings',
		impact: 'Low',
		etMinutes: HH(10, 0),
		session: 'intraday',
		previousSeriesId: 'JTSJOL',
		// JOLTS openings are published in thousands, so 'K' is correct here.
		previousUnits: 'lin',
		previousSuffix: 'K',
		rationale:
			'Low. Released with roughly a two-month lag, so it is largely stale by publication and tends to confirm rather than surprise. BLS, 10:00 ET.',
	},
];

/**
 * FOMC rate decisions.
 *
 * These do NOT come from FRED. FOMC meetings are not a FRED "release" — FRED
 * carries the resulting rate series (e.g. DFEDTARU) but not the meeting
 * calendar. The Fed publishes the calendar as HTML/RSS only, with no JSON or
 * ICS feed, so this is a hand-maintained table.
 *
 * That is acceptable here because meeting dates are set roughly two years in
 * advance and effectively never move. Refresh this list annually.
 *
 * Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 * Transcribed 2026-08-25. Dates below are the SECOND (decision) day of each
 * two-day meeting, which is when the statement lands.
 */
export const FOMC_DECISION_DATES: string[] = [
	// 2026
	'2026-01-28',
	'2026-03-18',
	'2026-04-29',
	'2026-06-17',
	'2026-07-29',
	'2026-09-16',
	'2026-10-28',
	'2026-12-09',
	// 2027
	'2027-01-27',
	'2027-03-17',
	'2027-04-28',
	'2027-06-09',
	'2027-07-28',
	'2027-09-15',
	'2027-10-27',
	'2027-12-08',
];

export const FOMC_EVENT_TYPE: MacroEventType = {
	key: 'fomc-rate-decision',
	title: 'FOMC Rate Decision',
	impact: 'High',
	/**
	 * The post-meeting statement is released at 14:00 ET; the press conference
	 * follows at 14:30 ET. We tag the statement time, since that is the print
	 * the market reacts to first.
	 * Source: federalreserve.gov/monetarypolicy/fomccalendars.htm
	 */
	etMinutes: HH(14, 0),
	session: 'intraday',
	rationale:
		'Named High in CLAUDE.md. The single highest-impact scheduled event on the calendar — it sets the policy rate directly rather than being an input to it.',
};

/**
 * Earnings impact tiers.
 *
 * CLAUDE.md specifies impact as a fixed lookup by event TYPE and explicitly
 * forbids a custom scoring model, but it does not say how earnings get
 * tagged — every named example is a macro release. This is the one
 * classification call the spec does not cover, resolved as follows:
 *
 * A fixed, documented market-cap threshold table. It is a constant lookup
 * (nothing learned, nothing weighted) and it reads cap straight from the
 * NASDAQ payload we already fetch, so it cannot go stale the way a hardcoded
 * list of "important tickers" would.
 *
 * Rationale for the cut points: index moves scale with index WEIGHT, and
 * weight in both the S&P 500 and the Nasdaq-100 is market-cap proportional.
 * A single ~$1T name is several percent of the index on its own, so its print
 * can move the index directly; a $50B name essentially cannot.
 *
 * Swap this for a curated ticker list if you would rather — it is isolated
 * here precisely so that is a one-file change.
 */
export const EARNINGS_IMPACT_TIERS: {
	minMarketCapUsd: number;
	impact: Impact;
}[] = [
	{ minMarketCapUsd: 500_000_000_000, impact: 'High' },
	{ minMarketCapUsd: 50_000_000_000, impact: 'Medium' },
	{ minMarketCapUsd: 0, impact: 'Low' },
];

export function impactForMarketCap(marketCapUsd: number | null): Impact {
	if (marketCapUsd === null) return 'Low';
	for (const tier of EARNINGS_IMPACT_TIERS) {
		if (marketCapUsd >= tier.minMarketCapUsd) return tier.impact;
	}
	return 'Low';
}

/** Sort order for ranking within a day: High first. */
export const IMPACT_RANK: Record<Impact, number> = {
	High: 0,
	Medium: 1,
	Low: 2,
};
