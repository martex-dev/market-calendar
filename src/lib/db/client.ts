/**
 * Database access (libSQL / Turso).
 *
 * WHY A DATABASE AT ALL: this product polls two external sources on a
 * schedule and serves merged, cached results — it does not compute per
 * request (CLAUDE.md). NASDAQ in particular costs one HTTP round trip per
 * calendar day at ~2s each, so fetching at render time is not viable.
 *
 * WHY TURSO/libSQL OVER VERCEL POSTGRES: the workload is ~10k rows, written
 * once a day, read constantly, with no relational complexity. Turso's free
 * tier needs no card and does not suspend when idle. Postgres would be the
 * better call if we later wanted multiple writers or real relational queries;
 * moving is roughly a day's work, so this is a deliberate trade, not an
 * oversight.
 *
 * LOCAL DEV: with no Turso credentials set we fall back to a local SQLite
 * file, so the app runs immediately after `npm install` with no signup.
 */

import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;

export function db(): Client {
	if (client) return client;

	const url = process.env.TURSO_DATABASE_URL;
	const authToken = process.env.TURSO_AUTH_TOKEN;

	client = url
		? createClient({ url, authToken })
		: // file: URLs are libSQL's local SQLite mode. Not usable on Vercel
			// (serverless filesystems are ephemeral and read-only), which is
			// exactly why TURSO_DATABASE_URL is required in production.
			createClient({ url: 'file:market-calendar.db' });

	return client;
}

/** True when we are running against a real Turso instance rather than a file. */
export function isRemoteDb(): boolean {
	return Boolean(process.env.TURSO_DATABASE_URL);
}

/**
 * Create the schema if it does not exist.
 *
 * Called by the refresh job and by page reads, so a fresh clone works with no
 * migration step.
 *
 * Memoised per process. The statements are idempotent, but against a REMOTE
 * Turso database each one is a network round trip — running three of them on
 * every page render would add real latency to every request for no benefit.
 * The promise (not a boolean) is cached so concurrent first requests wait on
 * one execution rather than racing to run it three times over.
 */
let schemaReady: Promise<void> | null = null;

export function resetSchemaCache(): void {
	schemaReady = null;
}

export async function ensureSchema(): Promise<void> {
	if (!schemaReady) {
		schemaReady = createSchema().catch((err) => {
			// Never cache a failure: a transient connection error at boot would
			// otherwise poison every later request in this process.
			schemaReady = null;
			throw err;
		});
	}
	return schemaReady;
}

async function createSchema(): Promise<void> {
	const c = db();
	await c.execute(`
		CREATE TABLE IF NOT EXISTS events (
			id           TEXT PRIMARY KEY,
			kind         TEXT NOT NULL,
			date         TEXT NOT NULL,
			et_minutes   INTEGER,
			session      TEXT NOT NULL,
			title        TEXT NOT NULL,
			impact       TEXT NOT NULL,
			symbol       TEXT,
			forecast     TEXT,
			previous     TEXT,
			source       TEXT NOT NULL,
			updated_at   TEXT NOT NULL
		)
	`);
	// The only query pattern we have is "everything in this date range",
	// ordered within the day. One index covers both views.
	await c.execute(
		'CREATE INDEX IF NOT EXISTS idx_events_date ON events (date)',
	);
	await c.execute(`
		CREATE TABLE IF NOT EXISTS refresh_log (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			ran_at      TEXT NOT NULL,
			ok          INTEGER NOT NULL,
			detail      TEXT NOT NULL
		)
	`);
}
