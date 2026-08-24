/**
 * FOMC rate decisions.
 *
 * Deliberately NOT part of the FRED client. FOMC meetings are not a FRED
 * release — FRED carries the resulting rate series but not the meeting
 * calendar — so folding this into src/lib/fred/ would misrepresent where the
 * data comes from.
 *
 * The dates themselves live in src/lib/impact.ts next to their impact tag,
 * with the federalreserve.gov citation. This file just shapes them.
 */

import { FOMC_DECISION_DATES, FOMC_EVENT_TYPE } from './impact';
import { buildEventId, type MarketEvent } from './types';

export function fetchFomcEvents(opts: {
	start: string;
	end: string;
}): MarketEvent[] {
	return FOMC_DECISION_DATES.filter(
		(d) => d >= opts.start && d <= opts.end,
	).map((date) => ({
		id: buildEventId('macro', date, FOMC_EVENT_TYPE.key),
		kind: 'macro' as const,
		date,
		etMinutes: FOMC_EVENT_TYPE.etMinutes,
		session: FOMC_EVENT_TYPE.session,
		title: FOMC_EVENT_TYPE.title,
		impact: FOMC_EVENT_TYPE.impact,
		symbol: null,
		forecast: null,
		previous: null,
		source: 'federalreserve' as const,
	}));
}

/**
 * How far ahead our hand-maintained table reaches. The refresh job warns when
 * we are within 90 days of running out, so the list gets topped up before the
 * calendar silently loses its highest-impact event type.
 */
export function fomcCoverageEndsOn(): string {
	return FOMC_DECISION_DATES[FOMC_DECISION_DATES.length - 1] ?? '';
}
