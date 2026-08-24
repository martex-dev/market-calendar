/**
 * Reads and writes for the merged event table.
 */

import { db, ensureSchema } from './client';
import { IMPACT_RANK } from '../impact';
import type { Impact, MarketEvent, Session } from '../types';

/**
 * Upsert events.
 *
 * Upsert rather than delete-then-insert so that a partial refresh (say
 * NASDAQ is down but FRED succeeded) leaves the other source's rows intact.
 * `id` is deterministic and excludes forecast/previous, so re-running picks
 * up revised estimates without duplicating rows.
 */
export async function upsertEvents(events: MarketEvent[]): Promise<number> {
	if (events.length === 0) return 0;
	await ensureSchema();
	const c = db();
	const now = new Date().toISOString();

	const statements = events.map((e) => ({
		sql: `
			INSERT INTO events
				(id, kind, date, et_minutes, session, title, impact, symbol, forecast, previous, source, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				et_minutes = excluded.et_minutes,
				session    = excluded.session,
				title      = excluded.title,
				impact     = excluded.impact,
				forecast   = excluded.forecast,
				previous   = excluded.previous,
				source     = excluded.source,
				updated_at = excluded.updated_at
		`,
		args: [
			e.id,
			e.kind,
			e.date,
			e.etMinutes,
			e.session,
			e.title,
			e.impact,
			e.symbol,
			e.forecast,
			e.previous,
			e.source,
			now,
		],
	}));

	// libSQL batches in a single round trip, which matters when the database
	// is remote and we are writing a few thousand rows.
	await c.batch(statements, 'write');
	return events.length;
}

interface EventRow {
	id: string;
	kind: string;
	date: string;
	et_minutes: number | null;
	session: string;
	title: string;
	impact: string;
	symbol: string | null;
	forecast: string | null;
	previous: string | null;
	source: string;
}

function toDomain(r: EventRow): MarketEvent {
	return {
		id: r.id,
		kind: r.kind as MarketEvent['kind'],
		date: r.date,
		etMinutes: r.et_minutes,
		session: r.session as Session,
		title: r.title,
		impact: r.impact as Impact,
		symbol: r.symbol,
		forecast: r.forecast,
		previous: r.previous,
		source: r.source as MarketEvent['source'],
	};
}

/**
 * THE MERGE.
 *
 * This is the product (CLAUDE.md): macro releases and earnings come back
 * interleaved in one ordered list, not as two separate result sets that the
 * UI stitches together. Because both kinds live in one table, "merged" is the
 * natural read and "separated" would be the extra work — which is the right
 * way round for this codebase.
 *
 * Ordering within a day: timed events first in clock order, then untimed
 * ones; ties broken by impact (High first) so the most important event of a
 * given minute leads.
 */
export async function getEventsInRange(
	start: string,
	end: string,
): Promise<MarketEvent[]> {
	await ensureSchema();
	const c = db();
	const res = await c.execute({
		sql: `
			SELECT id, kind, date, et_minutes, session, title, impact, symbol,
			       forecast, previous, source
			FROM events
			WHERE date >= ? AND date <= ?
			ORDER BY date ASC,
			         CASE WHEN et_minutes IS NULL THEN 1 ELSE 0 END ASC,
			         et_minutes ASC
		`,
		args: [start, end],
	});

	const events = (res.rows as unknown as EventRow[]).map(toDomain);

	// Impact ordering is a stable secondary sort done here rather than in SQL,
	// so the ranking lives next to the IMPACT_RANK table it depends on.
	return events.sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? -1 : 1;
		const at = a.etMinutes ?? Number.MAX_SAFE_INTEGER;
		const bt = b.etMinutes ?? Number.MAX_SAFE_INTEGER;
		if (at !== bt) return at - bt;
		return IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact];
	});
}

/** Group a flat event list into one bucket per date key. */
export function groupByDate(
	events: MarketEvent[],
	dates: string[],
): Map<string, MarketEvent[]> {
	const map = new Map<string, MarketEvent[]>();
	for (const d of dates) map.set(d, []);
	for (const e of events) {
		if (!map.has(e.date)) map.set(e.date, []);
		map.get(e.date)!.push(e);
	}
	return map;
}

/**
 * The next few High-impact events from today onward, for the ticker strip.
 *
 * Deliberately High only: the strip is a "what is coming that actually
 * matters" readout, and filling it with Low-impact earnings would defeat that.
 */
export async function getUpcomingHighImpact(
	fromDate: string,
	limit = 8,
): Promise<MarketEvent[]> {
	await ensureSchema();
	const res = await db().execute({
		sql: `
			SELECT id, kind, date, et_minutes, session, title, impact, symbol,
			       forecast, previous, source
			FROM events
			WHERE date >= ? AND impact = 'High'
			ORDER BY date ASC,
			         CASE WHEN et_minutes IS NULL THEN 1 ELSE 0 END ASC,
			         et_minutes ASC
			LIMIT ?
		`,
		args: [fromDate, limit],
	});
	return (res.rows as unknown as EventRow[]).map(toDomain);
}

export async function logRefresh(ok: boolean, detail: string): Promise<void> {
	await ensureSchema();
	await db().execute({
		sql: 'INSERT INTO refresh_log (ran_at, ok, detail) VALUES (?, ?, ?)',
		args: [new Date().toISOString(), ok ? 1 : 0, detail],
	});
}

export async function getLastRefresh(): Promise<{
	ranAt: string;
	ok: boolean;
	detail: string;
} | null> {
	await ensureSchema();
	const res = await db().execute(
		'SELECT ran_at, ok, detail FROM refresh_log ORDER BY id DESC LIMIT 1',
	);
	const row = res.rows[0] as unknown as
		| { ran_at: string; ok: number; detail: string }
		| undefined;
	if (!row) return null;
	return { ranAt: row.ran_at, ok: row.ok === 1, detail: row.detail };
}
