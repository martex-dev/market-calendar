/**
 * Headlines as JSON, for the news rail's background poll.
 *
 * The rail is server-rendered on first paint so it is there with the HTML and
 * works with JS off. This route exists only so the client can quietly replace
 * that list every few minutes without a navigation — the difference between a
 * page that was current when you opened it and one that stays current while
 * you leave it open.
 *
 * No auth, unlike /api/cron/refresh. That route writes to the database and
 * hammers two third-party APIs; this one is a cached read of feeds that are
 * already public, and the Data Cache means a burst of callers collapses onto
 * one upstream fetch per TTL.
 */

import { NextResponse } from 'next/server';
import { getMarketNews, NEWS_REVALIDATE_SECONDS } from '@/lib/news';
import { getEventsInRange } from '@/lib/db/events';
import { addDays, todayET } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET() {
	const today = todayET();

	// Ticker linking needs the earnings rows in view. If the database is
	// unreachable we still serve headlines — they just come back without
	// symbol tags, which is a strictly smaller loss than an empty rail.
	let events: Awaited<ReturnType<typeof getEventsInRange>> = [];
	try {
		events = await getEventsInRange(addDays(today, -7), addDays(today, 45));
	} catch {
		events = [];
	}

	const news = await getMarketNews({ events, limit: 40 });

	return NextResponse.json(news, {
		headers: {
			// Let a CDN or the browser reuse this for the same window the
			// upstream fetches are cached for, and serve stale while it
			// refreshes rather than making a poller wait on six feeds.
			'cache-control': `public, s-maxage=${NEWS_REVALIDATE_SECONDS}, stale-while-revalidate=1800`,
		},
	});
}
