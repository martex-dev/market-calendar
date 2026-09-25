/**
 * The merged calendar as JSON, for other tools (Forge's Trade room reads its
 * earnings from here).
 *
 *   GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD[&kind=earnings|macro]
 *
 * No auth, like /api/news and /api/quotes: it is a read of rows the calendar
 * pages already show publicly, and it writes nothing. Dates are ET calendar
 * dates, exactly as stored — see MarketEvent in src/lib/types.ts.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getEventsInRange } from '@/lib/db/events';
import { addDays, isDateKey, todayET } from '@/lib/time';
import type { EventKind } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** The database only holds a -30/+90 day window; a wider ask is a mistake. */
const MAX_DAYS = 120;
const KINDS: EventKind[] = ['macro', 'earnings'];

function bad(message: string): NextResponse {
	return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
	const params = request.nextUrl.searchParams;
	const today = todayET();
	const start = params.get('start') ?? today;
	if (!isDateKey(start)) return bad('start must be YYYY-MM-DD');
	// Checked before the default below: addDays() on junk would throw.
	const end = params.get('end') ?? addDays(start, 6);
	if (!isDateKey(end)) return bad('end must be YYYY-MM-DD');
	const kind = params.get('kind');

	if (end < start) return bad('end is before start');
	if (end > addDays(start, MAX_DAYS)) {
		return bad(`at most ${MAX_DAYS} days per request`);
	}
	if (kind !== null && !KINDS.includes(kind as EventKind)) {
		return bad(`kind must be one of: ${KINDS.join(', ')}`);
	}

	let events;
	try {
		events = await getEventsInRange(start, end);
	} catch (err) {
		// The pages degrade the same way; say so rather than return an empty
		// list that reads as "nothing scheduled".
		console.error('/api/events: database read failed', err);
		return NextResponse.json({ error: 'calendar database unavailable' }, { status: 503 });
	}

	return NextResponse.json(
		{ start, end, events: kind ? events.filter((e) => e.kind === kind) : events },
		{
			headers: {
				// The data changes once a day (the cron refresh); a few minutes of
				// CDN reuse is invisible and spares the database.
				'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
			},
		},
	);
}
