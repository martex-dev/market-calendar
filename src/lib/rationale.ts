/**
 * Row-level provenance, resolved from an event back to the table that
 * classified it.
 *
 * CLAUDE.md requires every impact tag to cite why it landed where it did, and
 * src/lib/impact.ts already carries that text per entry. Until now it lived
 * only in the source file, which meant the product's central claim — these
 * rankings are reviewable — was true for anyone reading the repository and
 * invisible to anyone reading the site.
 *
 * This module is the join. It exists so the expandable row can print the
 * rationale verbatim rather than paraphrasing it in JSX, which would let the
 * two drift.
 */

import {
	EARNINGS_IMPACT_TIERS,
	FOMC_EVENT_TYPE,
	MACRO_RELEASE_TYPES,
} from './impact';
import { SOURCE_META } from './sources';
import type { MarketEvent } from './types';

export interface EventDetail {
	/** Why this row carries the impact tag it carries. */
	rationale: string;
	/** Where the row came from, long form. */
	sourceDetail: string;
	/** Canonical page for the underlying release, when one exists. */
	sourceUrl: string | null;
	/** Extra context lines, each already display-ready. */
	notes: string[];
}

/**
 * Event ids are `kind:date:key` (see buildEventId), so the classification key
 * is the third segment. Splitting is safe because none of our keys contain a
 * colon — macro keys are slugs and earnings keys are tickers.
 */
function keyOf(event: MarketEvent): string {
	const parts = event.id.split(':');
	return parts.length >= 3 ? parts.slice(2).join(':') : '';
}

const MACRO_HOME: Record<string, string> = {
	cpi: 'https://www.bls.gov/cpi/',
	'employment-situation': 'https://www.bls.gov/news.release/empsit.toc.htm',
	'gross-domestic-product': 'https://www.bea.gov/data/gdp/gross-domestic-product',
	'personal-income-and-outlays':
		'https://www.bea.gov/data/income-saving/personal-income',
	'producer-price-index': 'https://www.bls.gov/ppi/',
	'retail-sales': 'https://www.census.gov/retail/index.html',
	'jobless-claims': 'https://www.dol.gov/ui/data.pdf',
	jolts: 'https://www.bls.gov/jlt/',
	'fomc-rate-decision':
		'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
};

function tierLabel(): string {
	// Rendered from the table itself so a threshold edit updates the copy.
	return EARNINGS_IMPACT_TIERS.filter((t) => t.minMarketCapUsd > 0)
		.map(
			(t) =>
				`${t.impact} at or above $${(t.minMarketCapUsd / 1e9).toLocaleString('en-US')}B`,
		)
		.join(', ');
}

export function eventDetail(event: MarketEvent): EventDetail {
	const key = keyOf(event);
	const sourceDetail = SOURCE_META[event.source]?.detail ?? event.source;
	const notes: string[] = [];

	if (event.kind === 'macro') {
		const type =
			key === FOMC_EVENT_TYPE.key
				? FOMC_EVENT_TYPE
				: MACRO_RELEASE_TYPES.find((t) => t.key === key);

		if (type) {
			// FRED's release/dates endpoint carries no clock time; the times on
			// these rows are the issuing agency's publication convention, and
			// saying so is the difference between a schedule and a guess.
			notes.push(
				'Release time is the issuing agency’s standing publication schedule, not a value returned by the source API.',
			);
			if (event.forecast === null) {
				notes.push(
					'No forecast: FRED publishes no consensus estimates of any kind, so macro rows carry a previous value only.',
				);
			}
			return {
				rationale: type.rationale,
				sourceDetail,
				sourceUrl: MACRO_HOME[key] ?? null,
				notes,
			};
		}
	}

	if (event.kind === 'earnings') {
		notes.push(
			'Consensus EPS and the reporting date come from NASDAQ; the date is the company’s scheduled report, which issuers do occasionally move.',
		);
		if (event.etMinutes === null) {
			notes.push(
				'No time: NASDAQ only populates its timing field for upcoming dates, and returns “time-not-supplied” for past ones.',
			);
		}
		return {
			rationale: `Impact is assigned by market capitalisation from a fixed threshold table (${tierLabel()}; everything below is Low). Index moves scale with index weight, and weight in both the S&P 500 and the Nasdaq-100 is market-cap proportional — so a mega-cap print can move the index directly where a mid-cap cannot.`,
			sourceDetail,
			sourceUrl: event.symbol
				? `https://www.nasdaq.com/market-activity/stocks/${event.symbol.toLowerCase()}/earnings`
				: null,
			notes,
		};
	}

	return {
		rationale:
			'No classification note recorded for this row. That is a gap — every event type is supposed to carry one (see src/lib/impact.ts).',
		sourceDetail,
		sourceUrl: null,
		notes,
	};
}
