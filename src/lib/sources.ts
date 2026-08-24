/**
 * Display metadata for the source stamp on every row.
 *
 * CLAUDE.md requires each event type's classification to cite where it came
 * from. This surfaces that in the UI rather than leaving it only in code
 * comments: the stamp is the product's claim to being sourced rather than
 * assembled, so it is a design element and a spec requirement at once.
 */

import type { MarketEvent } from './types';

interface SourceMeta {
	/** Short label rendered in the stamp. */
	label: string;
	/** Longer description for the title attribute. */
	detail: string;
}

export const SOURCE_META: Record<MarketEvent['source'], SourceMeta> = {
	fred: {
		label: 'FRED',
		detail:
			'Release date from the FRED API (St. Louis Fed) release/dates endpoint',
	},
	federalreserve: {
		label: 'FED',
		detail:
			'FOMC decision date from federalreserve.gov/monetarypolicy/fomccalendars.htm',
	},
	nasdaq: {
		label: 'NASDAQ',
		detail: 'Reporting date and consensus EPS from NASDAQ’s public calendar API',
	},
};

export function sourceMeta(source: MarketEvent['source']): SourceMeta {
	return SOURCE_META[source] ?? { label: source, detail: source };
}

/**
 * Classify a formatted number for colouring.
 *
 * Only signed values (percent changes, period changes) get direction colour.
 * Plain levels like "206,000" or "EPS $2.09" stay neutral — colouring those
 * would imply a direction the number does not carry.
 */
export function direction(value: string | null): 'pos' | 'neg' | null {
	if (!value) return null;
	if (value.startsWith('+')) return 'pos';
	if (value.startsWith('-')) return 'neg';
	return null;
}
