/**
 * The news leg: fetch every curated feed, tag each headline against the
 * calendar, and return one merged, de-duplicated, newest-first list.
 *
 * This mirrors the shape of src/lib/refresh.ts on purpose — every feed is
 * allowed to fail on its own and the others still render. A dead wire costs
 * you that wire's headlines, never the rail.
 *
 * There is no `news` table. See the note in ./rss.ts: calendar rows are
 * written once a day by cron, but headlines move hourly, so they live in
 * Next's fetch cache with a minutes-long TTL instead of under a once-daily
 * Hobby cron that would serve yesterday's news all day.
 */

import { NEWS_FEEDS, type FeedTier } from './feeds';
import { fetchFeed } from './rss';
import { buildCompanyIndex, matchSymbols, matchTopics } from './topics';
import { buildReportDates } from '../earnings/reportDates';
import { todayET } from '../time';
import type { MarketEvent } from '../types';

export interface NewsItem {
	id: string;
	title: string;
	url: string;
	summary: string;
	/** ISO instant, or null when the feed gave us no usable date. */
	publishedAt: string | null;
	/** Feed key, matching NEWS_FEEDS. */
	source: string;
	sourceLabel: string;
	tier: FeedTier;
	/** Topic keys from src/lib/news/topics.ts. */
	topics: string[];
	/** Tickers whose company reports inside the loaded calendar window. */
	symbols: string[];
}

export interface NewsResult {
	items: NewsItem[];
	/** Feeds that failed, surfaced rather than swallowed. */
	failed: { source: string; error: string }[];
	fetchedAt: string;
	/**
	 * Ticker -> the date that company reports, for every symbol tagged above.
	 *
	 * Without this a ticker chip can only filter the range you are already
	 * looking at, which is usually the wrong one: a story about Nvidia runs
	 * the week AFTER Nvidia reported, so clicking it filtered September down
	 * to nothing. With it the chip can take you to the row it is talking
	 * about.
	 */
	symbolDates: Record<string, string>;
}

/** How stale a headline may be before the rail stops carrying it. */
const MAX_AGE_DAYS = 21;

/** Cache TTL. Well inside every publisher's expectation for a polite reader. */
export const NEWS_REVALIDATE_SECONDS = 600;

/**
 * Cheap stable key (FNV-1a) over source + link + title.
 *
 * The link alone is NOT unique. Census points every item in its briefing-room
 * feed at the same generic indicators page — retail inventories, trade in
 * goods and durable goods all carry the identical <link> — so keying on URL
 * collides and React drops rows. The title disambiguates them; the source
 * prefix keeps two outlets running the same headline apart.
 */
function idFor(...parts: string[]): string {
	const s = parts.join('|');
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}

/** Titles reduced for duplicate detection across wires. */
function dedupeKey(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function getMarketNews(opts: {
	/** Earnings rows in the loaded window, used to link headlines to tickers. */
	events?: MarketEvent[];
	limit?: number;
} = {}): Promise<NewsResult> {
	const companyIndex = buildCompanyIndex(opts.events ?? []);
	const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;

	const settled = await Promise.allSettled(
		NEWS_FEEDS.map(async (feed) => {
			const raw = await fetchFeed(feed.url, {
				revalidateSeconds: NEWS_REVALIDATE_SECONDS,
			});

			return raw.map((r): NewsItem => {
				const text = `${r.title} ${r.summary}`;
				return {
					id: idFor(feed.key, r.link, r.title),
					title: r.title,
					url: r.link,
					// Agency feeds paste a whole release into <description>. One
					// clause is all a dense card can carry.
					summary: r.summary.slice(0, 240),
					publishedAt: r.publishedAt,
					source: feed.key,
					sourceLabel: feed.label,
					tier: feed.tier,
					topics: matchTopics(text),
					symbols: matchSymbols(text, companyIndex),
				};
			});
		}),
	);

	const failed: NewsResult['failed'] = [];
	const merged: NewsItem[] = [];

	settled.forEach((res, i) => {
		if (res.status === 'rejected') {
			failed.push({
				source: NEWS_FEEDS[i].key,
				error: String(res.reason).slice(0, 200),
			});
			return;
		}
		merged.push(...res.value);
	});

	const seen = new Set<string>();
	const items = merged
		.filter((n) => {
			if (!n.publishedAt) return false;
			if (Date.parse(n.publishedAt) < cutoff) return false;
			// THE RELEVANCE GATE. A wire item that matches no topic and no
			// ticker on the calendar is not market news for our purposes — the
			// two wires also run personal-finance columns and consumer-brand
			// stories. Agency feeds are exempt: everything an agency publishes
			// on these channels is by definition about a scheduled release.
			if (n.tier !== 'primary' && n.topics.length === 0 && n.symbols.length === 0) {
				return false;
			}
			const k = dedupeKey(n.title);
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		})
		.sort((a, b) => (a.publishedAt! < b.publishedAt! ? 1 : -1))
		.slice(0, opts.limit ?? 40);

	const tagged = new Set(items.flatMap((n) => n.symbols));

	return {
		items,
		failed,
		fetchedAt: new Date().toISOString(),
		symbolDates: buildReportDates(opts.events ?? [], tagged, todayET()),
	};
}
