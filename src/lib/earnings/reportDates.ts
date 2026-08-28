/**
 * "When does this ticker report?"
 *
 * Pulled out of the news module because two different surfaces now ask the
 * same question and must not answer it differently: a ticker chip on a
 * headline, and a mega-cap tile on the quote board. Both want to jump you to
 * the row, and both would be broken in the same way by the same wrong rule.
 */

import type { MarketEvent } from '../types';

/**
 * Pick one date per requested ticker: the next report if there is one ahead,
 * otherwise the most recent one behind.
 *
 * A company can appear twice in a 52-day window (rare, but a quarter-end
 * shift does it), and "the one that has not happened yet" is what somebody
 * clicking a ticker wants. The fallback to the latest past date matters more
 * in practice — most coverage of a print runs after it, and a tile you click
 * during earnings season is usually about a report that just landed.
 */
export function buildReportDates(
	events: MarketEvent[],
	symbols: Set<string>,
	today: string,
): Record<string, string> {
	if (symbols.size === 0) return {};
	const out: Record<string, string> = {};

	for (const e of events) {
		if (e.kind !== 'earnings' || !e.symbol || !symbols.has(e.symbol)) continue;

		const current = out[e.symbol];
		if (!current) {
			out[e.symbol] = e.date;
			continue;
		}

		const currentAhead = current >= today;
		const candidateAhead = e.date >= today;

		if (candidateAhead && !currentAhead) out[e.symbol] = e.date;
		else if (candidateAhead === currentAhead) {
			// Both ahead: the sooner one. Both behind: the more recent one.
			out[e.symbol] = candidateAhead
				? e.date < current
					? e.date
					: current
				: e.date > current
					? e.date
					: current;
		}
	}

	return out;
}
