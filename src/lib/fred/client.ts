/**
 * Low-level FRED API client.
 *
 * This module knows about HTTP, the API key, and FRED's error shape — and
 * nothing about our domain. Mapping FRED responses into MarketEvents happens
 * in ./releases.ts.
 *
 * Per CLAUDE.md this module must not reach into the earnings client, and vice
 * versa. They share only src/lib/types.ts.
 *
 * Docs: https://fred.stlouisfed.org/docs/api/fred/
 * Rate limit: 120 requests/minute per key. Our daily refresh uses ~20, so we
 * do not implement throttling — but we do surface 429s clearly rather than
 * silently returning empty data, because an empty calendar and a rate-limited
 * calendar should not look the same.
 */

const FRED_BASE = 'https://api.stlouisfed.org/fred';

export class FredError extends Error {
	// Plain fields rather than TS parameter properties: parameter properties
	// are a runtime feature that Node's type-stripping cannot erase, and
	// scripts/refresh.ts runs this file through Node directly.
	status: number;
	endpoint: string;

	constructor(message: string, status: number, endpoint: string) {
		super(message);
		this.name = 'FredError';
		this.status = status;
		this.endpoint = endpoint;
	}
}

function apiKey(): string {
	const key = process.env.FRED_API_KEY;
	if (!key) {
		throw new FredError(
			'FRED_API_KEY is not set. Get a free key at https://fredaccount.stlouisfed.org/apikeys and add it to .env.local',
			0,
			'(config)',
		);
	}
	return key;
}

/**
 * Issue a GET against a FRED endpoint and return parsed JSON.
 *
 * FRED signals errors two different ways: a non-2xx status, and (for some
 * cases) a 200 with an error_code body. We normalise both into FredError.
 */
export async function fredGet<T>(
	endpoint: string,
	params: Record<string, string | number | undefined>,
): Promise<T> {
	const url = new URL(`${FRED_BASE}/${endpoint}`);
	url.searchParams.set('api_key', apiKey());
	url.searchParams.set('file_type', 'json');
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined) url.searchParams.set(k, String(v));
	}

	const res = await fetch(url, {
		// The refresh job owns caching via the database; we never want a stale
		// fetch layer sitting in between and hiding that.
		cache: 'no-store',
		headers: { accept: 'application/json' },
	});

	const text = await res.text();

	if (res.status === 429) {
		throw new FredError(
			'FRED rate limit hit (120 req/min). Back off and retry.',
			429,
			endpoint,
		);
	}

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new FredError(
			`FRED returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`,
			res.status,
			endpoint,
		);
	}

	if (!res.ok) {
		const msg =
			(body as { error_message?: string })?.error_message ??
			`HTTP ${res.status}`;
		throw new FredError(msg, res.status, endpoint);
	}

	return body as T;
}

/* ---------- Response shapes (only the fields we actually consume) ---------- */

export interface FredRelease {
	id: number;
	name: string;
	press_release: boolean;
	link?: string;
}

export interface FredReleasesResponse {
	releases: FredRelease[];
	count: number;
	limit: number;
	offset: number;
}

export interface FredReleaseDate {
	release_id: number;
	/** YYYY-MM-DD */
	date: string;
	release_name?: string;
}

export interface FredReleaseDatesResponse {
	release_dates: FredReleaseDate[];
	count: number;
}

export interface FredObservation {
	date: string;
	value: string;
}

export interface FredObservationsResponse {
	observations: FredObservation[];
}

/**
 * List every release FRED knows about.
 *
 * We call this to resolve names -> numeric ids instead of hardcoding ids.
 * FRED ids are stable in practice, but hardcoding them means a silent
 * mismatch if one ever changes, and a lookup costs us one request per day.
 *
 * FRED caps `limit` at 1000 for this endpoint, so we page.
 */
export async function listReleases(): Promise<FredRelease[]> {
	const all: FredRelease[] = [];
	let offset = 0;
	const limit = 1000;

	for (;;) {
		const page = await fredGet<FredReleasesResponse>('releases', {
			limit,
			offset,
		});
		all.push(...page.releases);
		if (page.releases.length < limit) break;
		offset += limit;
		// Defensive stop: FRED has ~300 releases. If we ever page past 10k
		// something is wrong with our loop, not with FRED.
		if (offset > 10_000) break;
	}

	return all;
}

/**
 * Scheduled and historical dates for one release.
 *
 * `include_release_dates_with_no_data=true` is the important flag: without it
 * FRED only returns dates that already have data attached, which means no
 * FUTURE dates — and a calendar with no future dates is useless. With it, we
 * get the forward schedule FRED publishes.
 */
export async function getReleaseDates(
	releaseId: number,
	opts: { start: string; end: string },
): Promise<FredReleaseDate[]> {
	const res = await fredGet<FredReleaseDatesResponse>('release/dates', {
		release_id: releaseId,
		realtime_start: opts.start,
		realtime_end: opts.end,
		include_release_dates_with_no_data: 'true',
		sort_order: 'asc',
		limit: 10_000,
	});
	return res.release_dates ?? [];
}

/**
 * Most recent observation for a series, used to populate "previous".
 *
 * FRED has no consensus-forecast data of any kind, so "forecast" stays null
 * for every macro row. That is a source limitation, not an oversight.
 */
export async function getLatestObservation(
	seriesId: string,
	units: string = 'lin',
): Promise<FredObservation | null> {
	const res = await fredGet<FredObservationsResponse>('series/observations', {
		series_id: seriesId,
		// Let FRED do the transformation (year-over-year percent, period
		// change, etc). See previousUnits in src/lib/impact.ts for why raw
		// levels are the wrong thing to display.
		units,
		sort_order: 'desc',
		limit: 1,
	});
	const obs = res.observations?.[0];
	// FRED uses '.' to mean "no value for this period".
	if (!obs || obs.value === '.') return null;
	return obs;
}
