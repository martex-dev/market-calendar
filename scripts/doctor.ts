/**
 * Deployment preflight: `npm run doctor`.
 *
 * Checks that every piece of configuration the app needs is present and
 * actually works, and never prints a secret — only whether it is set, its
 * length, and whether the service accepts it.
 */

import { createClient } from '@libsql/client';

type Status = 'ok' | 'warn' | 'fail';

const results: { status: Status; label: string; detail: string }[] = [];

function record(status: Status, label: string, detail: string): void {
	results.push({ status, label, detail });
}

function present(name: string): string | undefined {
	const v = process.env[name];
	return v && v.trim() ? v.trim() : undefined;
}

async function checkFred(): Promise<void> {
	const key = present('FRED_API_KEY');
	if (!key) {
		record('fail', 'FRED_API_KEY', 'not set — macro releases will be missing');
		return;
	}
	if (!/^[0-9a-z]{32}$/.test(key)) {
		record(
			'warn',
			'FRED_API_KEY',
			`set but does not look like a FRED key (length ${key.length}, expected 32 lowercase alphanumerics)`,
		);
	}

	const url = new URL('https://api.stlouisfed.org/fred/releases');
	url.searchParams.set('api_key', key);
	url.searchParams.set('file_type', 'json');
	url.searchParams.set('limit', '1');

	try {
		const res = await fetch(url, { cache: 'no-store' });
		if (res.ok) {
			record('ok', 'FRED_API_KEY', 'set, and the API accepted it');
		} else {
			const body = (await res.json().catch(() => null)) as {
				error_message?: string;
			} | null;
			record(
				'fail',
				'FRED_API_KEY',
				`API rejected it: ${body?.error_message ?? `HTTP ${res.status}`}`,
			);
		}
	} catch (err) {
		record('warn', 'FRED_API_KEY', `could not reach FRED: ${String(err)}`);
	}
}

async function checkDatabase(): Promise<void> {
	const url = present('TURSO_DATABASE_URL');
	const token = present('TURSO_AUTH_TOKEN');

	if (!url) {
		record(
			'warn',
			'TURSO_DATABASE_URL',
			'not set — using the local SQLite file. Fine for development, but Vercel cannot use it (ephemeral filesystem).',
		);
		return;
	}
	if (!token) {
		record(
			'fail',
			'TURSO_AUTH_TOKEN',
			'TURSO_DATABASE_URL is set but the auth token is missing',
		);
		return;
	}

	// Show the host so it is obvious which database is targeted, but never
	// the token.
	let host = '(unparseable url)';
	try {
		host = new URL(url.replace(/^libsql:/, 'https:')).host;
	} catch {
		record('fail', 'TURSO_DATABASE_URL', `not a valid URL: ${url.slice(0, 24)}…`);
		return;
	}

	let client: ReturnType<typeof createClient> | null = null;
	try {
		client = createClient({ url, authToken: token });
		const started = Date.now();
		await client.execute('SELECT 1');
		const latency = Date.now() - started;

		let rows = 0;
		try {
			const r = await client.execute('SELECT COUNT(*) AS n FROM events');
			rows = Number((r.rows[0] as unknown as { n: number }).n) || 0;
		} catch {
			// Table not created yet — that is expected before the first refresh.
		}

		record(
			rows > 0 ? 'ok' : 'warn',
			'Turso database',
			rows > 0
				? `connected to ${host} in ${latency}ms — ${rows} events stored`
				: `connected to ${host} in ${latency}ms, but it holds 0 events. Run \`npm run refresh\` to seed it.`,
		);
	} catch (err) {
		record('fail', 'Turso database', `could not connect to ${host}: ${String(err)}`);
	} finally {
		// Leaving the socket open makes Node abort noisily on Windows at exit.
		client?.close();
	}
}

function checkCronSecret(): void {
	const secret = present('CRON_SECRET');
	if (!secret) {
		record(
			'warn',
			'CRON_SECRET',
			'not set. Required in production, or /api/cron/refresh is a public button that hits two third-party APIs on demand.',
		);
	} else if (secret.length < 16) {
		record(
			'warn',
			'CRON_SECRET',
			`set but only ${secret.length} characters — use at least 24`,
		);
	} else {
		record('ok', 'CRON_SECRET', `set (${secret.length} characters)`);
	}
}

async function main(): Promise<void> {
	await Promise.all([checkFred(), checkDatabase()]);
	checkCronSecret();

	const icon: Record<Status, string> = { ok: 'PASS', warn: 'WARN', fail: 'FAIL' };
	console.log('');
	for (const r of results) {
		console.log(`  [${icon[r.status]}] ${r.label}\n         ${r.detail}`);
	}

	const failed = results.filter((r) => r.status === 'fail').length;
	const warned = results.filter((r) => r.status === 'warn').length;
	console.log(
		`\n  ${results.length - failed - warned} passed, ${warned} warning(s), ${failed} failure(s)\n`,
	);
	// Set the code rather than calling process.exit(): an abrupt exit kills
	// tsx's esbuild worker mid-flight and Node aborts noisily on Windows.
	process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
