/**
 * Maps FRED releases onto our curated macro event list.
 *
 * The curated list and its impact tags live in src/lib/impact.ts; this file
 * only does the fetching and shaping. That split is deliberate (CLAUDE.md):
 * the classification table should be reviewable without reading fetch code.
 */

import {
	getLatestObservation,
	getReleaseDates,
	listReleases,
	type FredRelease,
} from './client';
import { MACRO_RELEASE_TYPES, type MacroReleaseType } from '../impact';
import { buildEventId, type MarketEvent } from '../types';

/**
 * Resolve our curated release names to FRED's numeric ids.
 *
 * Matching is case-insensitive and whitespace-normalised. If a name fails to
 * resolve we report it rather than silently dropping the release — a macro
 * calendar quietly missing CPI is a much worse failure than a loud one.
 */
export function resolveReleaseIds(fredReleases: FredRelease[]): {
	resolved: Map<string, number>;
	unresolved: string[];
} {
	const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
	const byName = new Map<string, number>();
	for (const r of fredReleases) byName.set(norm(r.name), r.id);

	const resolved = new Map<string, number>();
	const unresolved: string[] = [];

	for (const type of MACRO_RELEASE_TYPES) {
		const exact = byName.get(norm(type.fredReleaseName));
		if (exact !== undefined) {
			resolved.set(type.key, exact);
			continue;
		}
		// Fall back to a prefix match — FRED occasionally appends qualifiers
		// such as "(DISCONTINUED)" or a bracketed agency note.
		const target = norm(type.fredReleaseName);
		const partial = fredReleases.find((r) => norm(r.name).startsWith(target));
		if (partial) {
			resolved.set(type.key, partial.id);
		} else {
			unresolved.push(type.fredReleaseName);
		}
	}

	return { resolved, unresolved };
}

function formatPrevious(
	value: string,
	suffix: string,
	units: MacroReleaseType['previousUnits'],
): string {
	const n = Number(value);
	if (!Number.isFinite(n)) return value;

	// Percent and change transforms are signed quantities: "+150K" and
	// "-0.2% m/m" read correctly, "150K" and "0.2% m/m" hide the direction.
	const signed = units !== 'lin';
	const decimals = units === 'lin' ? 0 : 1;
	const formatted = Math.abs(n).toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});
	const sign = signed && n > 0 ? '+' : n < 0 ? '-' : '';

	return `${sign}${formatted}${suffix}`;
}

export interface FetchMacroResult {
	events: MarketEvent[];
	/** Release names we could not resolve to a FRED id — surfaced, not swallowed. */
	unresolved: string[];
	/** Releases that resolved but returned zero dates in the window. */
	empty: string[];
}

/**
 * Fetch all curated macro release dates in [start, end] and shape them into
 * MarketEvents.
 *
 * Request budget: 1 (releases list) + N (dates per release) + N (previous
 * value per release) where N = 8. That is ~17 requests against a 120/min
 * limit, so no throttling is needed.
 */
export async function fetchMacroEvents(opts: {
	start: string;
	end: string;
}): Promise<FetchMacroResult> {
	const fredReleases = await listReleases();
	const { resolved, unresolved } = resolveReleaseIds(fredReleases);

	const events: MarketEvent[] = [];
	const empty: string[] = [];

	// Fetch each release's dates and its latest observation concurrently.
	// N is 8, comfortably inside the rate limit even fully parallel.
	const work = MACRO_RELEASE_TYPES.map(async (type: MacroReleaseType) => {
		const releaseId = resolved.get(type.key);
		if (releaseId === undefined) return;

		const [dates, previousObs] = await Promise.all([
			getReleaseDates(releaseId, opts),
			type.previousSeriesId
				? getLatestObservation(
						type.previousSeriesId,
						type.previousUnits,
					).catch(() => null)
				: Promise.resolve(null),
		]);

		if (dates.length === 0) {
			empty.push(type.fredReleaseName);
			return;
		}

		const previous = previousObs
			? formatPrevious(
					previousObs.value,
					type.previousSuffix,
					type.previousUnits,
				)
			: null;

		for (const d of dates) {
			events.push({
				id: buildEventId('macro', d.date, type.key),
				kind: 'macro',
				date: d.date,
				etMinutes: type.etMinutes,
				session: type.session,
				title: type.title,
				impact: type.impact,
				symbol: null,
				// FRED publishes no consensus forecasts. Always null for macro.
				forecast: null,
				previous,
				source: 'fred',
			});
		}
	});

	await Promise.all(work);

	return { events, unresolved, empty };
}
