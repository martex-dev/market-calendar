import { NextResponse } from 'next/server';
import { runRefresh } from '@/lib/refresh';

/**
 * Scheduled refresh endpoint, invoked by Vercel Cron (see vercel.json).
 *
 * VERCEL SPECIFICS THAT CONSTRAIN THIS ROUTE:
 *
 *  - Hobby plan cron runs at most ONCE PER DAY. Any schedule that would fire
 *    more often is rejected at deploy time. That is fine here: release dates
 *    and earnings dates do not change minute to minute (CLAUDE.md).
 *
 *  - Hobby functions cap at 60 seconds. The NASDAQ leg is the one that scales
 *    with window width (one request per weekday). Measured 2026-08-25: the
 *    full refresh is ~2s for 87 requests, so we have a lot of headroom. If
 *    you widen WINDOW_FORWARD_DAYS a long way and start seeing timeouts, that
 *    is where to look first.
 *
 *  - Cron timing is only guaranteed within the hour, so a 06:00 job may fire
 *    any time before 07:00. Harmless for a daily data pull.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
	// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
	// whenever a CRON_SECRET environment variable exists on the project.
	// Without this check the endpoint is a public button that hammers two
	// third-party APIs on demand.
	const secret = process.env.CRON_SECRET;
	if (secret) {
		const auth = request.headers.get('authorization');
		if (auth !== `Bearer ${secret}`) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}
	}

	const summary = await runRefresh();

	// 200 even on partial failure — the job did run and did write what it
	// could. Non-2xx is reserved for "nothing usable happened", so Vercel's
	// cron failure alerts stay meaningful.
	return NextResponse.json(summary, {
		status: summary.totalUpserted > 0 || summary.ok ? 200 : 500,
	});
}
