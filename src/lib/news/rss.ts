/**
 * A small RSS 2.0 reader.
 *
 * WHY NOT AN RSS LIBRARY: all six curated feeds (src/lib/news/feeds.ts) are
 * plain RSS 2.0 — `channel > item` with title/link/description/pubDate. The
 * generic parsers exist to cope with Atom, RDF, namespace soup and podcast
 * extensions, none of which appear here. cheerio is already a dependency for
 * the S&P 500 constituent scrape, so this costs zero new packages.
 *
 * The trade-off, stated: if a feed ever switches to Atom this returns zero
 * items for it rather than adapting. That failure is visible (the source
 * disappears from the rail) and each feed degrades independently, which is
 * the same posture the rest of the refresh takes.
 */

import * as cheerio from 'cheerio';

export interface RssItem {
	title: string;
	link: string;
	summary: string;
	/** Publication instant as an ISO string, or null when unparseable. */
	publishedAt: string | null;
}

/**
 * Strip markup and collapse whitespace.
 *
 * BEA and Census put real HTML inside their CDATA descriptions — paragraph
 * tags, line breaks, sometimes a table. We want one clean sentence for a
 * dense rail, so tags are removed rather than rendered. Deliberately never
 * inject this as HTML anywhere: it is third-party text.
 */
function plain(html: string): string {
	if (!html) return '';
	return cheerio
		.load(`<div>${html}</div>`)('div')
		.text()
		.replace(/\s+/g, ' ')
		.trim();
}

/** RFC-822 dates, which is what every one of these feeds emits. */
function parseDate(raw: string): string | null {
	const t = Date.parse(raw.trim());
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseRss(xml: string): RssItem[] {
	// xmlMode keeps <link> as an element with text rather than treating it as
	// the void HTML <link>, which would silently yield an empty href on every
	// item.
	const $ = cheerio.load(xml, { xml: true });

	const items: RssItem[] = [];

	$('item').each((_, el) => {
		const node = $(el);
		const title = plain(node.children('title').first().text());
		const link = node.children('link').first().text().trim();
		if (!title || !link) return;

		items.push({
			title,
			link,
			summary: plain(node.children('description').first().text()),
			publishedAt: parseDate(node.children('pubDate').first().text()),
		});
	});

	return items;
}

export class FeedError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'FeedError';
		this.status = status;
	}
}

/**
 * Fetch and parse one feed.
 *
 * `revalidateSeconds` goes to Next's Data Cache rather than to a table of our
 * own. Calendar rows are written once a day by cron and belong in the
 * database; headlines change hourly and would be stale under a once-daily
 * Hobby cron, so they are cached at the fetch layer where the TTL can be
 * minutes instead. Nothing about news is worth a schema.
 *
 * A per-feed timeout matters more here than for FRED or NASDAQ: this runs on
 * the request path, and one wire hanging must not hold up a page render.
 */
export async function fetchFeed(
	url: string,
	opts: { revalidateSeconds: number; timeoutMs?: number } = {
		revalidateSeconds: 900,
	},
): Promise<RssItem[]> {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		opts.timeoutMs ?? 6000,
	);

	try {
		const res = await fetch(url, {
			signal: controller.signal,
			next: { revalidate: opts.revalidateSeconds },
			headers: {
				// Several of these publishers 403 an absent or default agent.
				'user-agent':
					'MarketCalendar/1.0 (+https://market-calendar-three.vercel.app)',
				accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
			},
		});

		if (!res.ok) throw new FeedError(`HTTP ${res.status}`, res.status);

		return parseRss(await res.text());
	} finally {
		clearTimeout(timer);
	}
}
