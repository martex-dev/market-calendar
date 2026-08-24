/**
 * Shared domain types.
 *
 * The whole point of this product (see CLAUDE.md) is that macro releases and
 * earnings end up in ONE list. So both collapse into a single `MarketEvent`
 * shape here rather than living as two parallel types that the UI has to
 * branch on. The `kind` discriminator exists only for display/filtering.
 */

export type Impact = 'High' | 'Medium' | 'Low';

export type EventKind = 'macro' | 'earnings';

/**
 * When during the trading day an event lands. NASDAQ reports earnings timing
 * as a coarse bucket rather than a clock time, so we keep that fidelity
 * instead of inventing a precise time we don't have.
 */
export type Session = 'premarket' | 'intraday' | 'afterhours' | 'unspecified';

export interface MarketEvent {
	/** Stable synthetic key, used for DB upserts. See buildEventId(). */
	id: string;
	kind: EventKind;
	/** Calendar date in ET, as YYYY-MM-DD. Never a timestamp — see note below. */
	date: string;
	/**
	 * Minutes past ET midnight, or null when the source gives us no time.
	 *
	 * We deliberately store (date, minutes-in-ET) rather than a UTC instant.
	 * Release schedules are defined in ET ("08:30 ET"), and storing UTC would
	 * make us re-derive the ET wall-clock on every read and get DST wrong at
	 * the boundaries. The Local toggle converts at render time instead.
	 */
	etMinutes: number | null;
	session: Session;
	/** Display name, e.g. 'Consumer Price Index' or 'Apple Inc. (AAPL)'. */
	title: string;
	impact: Impact;
	/** Ticker for earnings, null for macro. */
	symbol: string | null;
	/** Consensus forecast, pre-formatted for display. Null when unavailable. */
	forecast: string | null;
	/** Prior period's actual, pre-formatted for display. Null when unavailable. */
	previous: string | null;
	/** Where this row came from, for debugging and for the UI's source note. */
	source: 'fred' | 'nasdaq' | 'federalreserve';
}

/**
 * Deterministic id so that re-running the refresh job updates rows in place
 * instead of duplicating them. Must not include any field that legitimately
 * changes between refreshes (forecast, previous) — only identity.
 */
export function buildEventId(
	kind: EventKind,
	date: string,
	key: string,
): string {
	return `${kind}:${date}:${key}`.toLowerCase();
}
