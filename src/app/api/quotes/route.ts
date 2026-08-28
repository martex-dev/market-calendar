/**
 * Quotes as JSON, for the Bellwethers strip's poll.
 *
 * Public and unauthenticated, like /api/news and unlike /api/cron/refresh:
 * this writes nothing and reads an endpoint that is already public, and the
 * 60-second cache collapses a burst of pollers onto one upstream fetch.
 */

import { NextResponse } from 'next/server';
import { getBellwetherQuotes, QUOTE_REVALIDATE_SECONDS } from '@/lib/quotes';

export const dynamic = 'force-dynamic';

export async function GET() {
	const quotes = await getBellwetherQuotes();

	return NextResponse.json(quotes, {
		headers: {
			'cache-control': `public, s-maxage=${QUOTE_REVALIDATE_SECONDS}, stale-while-revalidate=120`,
		},
	});
}
