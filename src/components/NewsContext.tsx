'use client';

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { NewsItem, NewsResult } from '@/lib/news';

/**
 * Holds the headline list for the whole page and keeps it current.
 *
 * The list is server-rendered into the first response and handed here as
 * `initial`, so the rail is in the HTML, is indexable, and works with
 * JavaScript off. This provider's only job afterwards is to quietly replace
 * it — an open tab should not be showing three-hour-old news.
 *
 * It sits above both panels because the calendar needs it too: an expanded
 * row shows the coverage for that release, which is the same list filtered.
 * Fetching it twice, once per panel, would double the requests to say the
 * same thing.
 */

interface NewsState {
	items: NewsItem[];
	/** Feeds that failed on the most recent load. */
	failed: NewsResult['failed'];
	/** When the data we are showing was assembled, ISO. */
	fetchedAt: string;
	/** Ticker -> the date that company reports. See NewsResult.symbolDates. */
	symbolDates: Record<string, string>;
	refreshing: boolean;
	/** True once a background poll has replaced the server-rendered list. */
	live: boolean;
	refresh: () => void;
}

const NewsCtx = createContext<NewsState | null>(null);

/**
 * Five minutes. The upstream feeds are cached for ten (NEWS_REVALIDATE_SECONDS)
 * and the route sets stale-while-revalidate on top, so polling faster would
 * mostly re-read the same cache entry; polling much slower defeats the point
 * of a live rail.
 */
const POLL_MS = 5 * 60 * 1000;

export function NewsProvider({
	initial,
	children,
}: {
	initial: NewsResult;
	children: React.ReactNode;
}) {
	const [data, setData] = useState<NewsResult>(initial);
	const [refreshing, setRefreshing] = useState(false);
	const [live, setLive] = useState(false);
	// Guards against a slow response landing after the component unmounts and
	// against two polls overlapping when the network is slow.
	const inFlight = useRef(false);

	const refresh = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		setRefreshing(true);
		try {
			const res = await fetch('/api/news', { cache: 'no-store' });
			if (res.ok) {
				const next = (await res.json()) as NewsResult;
				if (Array.isArray(next.items) && next.items.length > 0) {
					setData(next);
					setLive(true);
				}
			}
		} catch {
			// A failed poll keeps whatever is on screen. Headlines going a few
			// minutes stale is not worth an error state in a side rail.
		} finally {
			inFlight.current = false;
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		const timer = setInterval(refresh, POLL_MS);

		// Coming back to a backgrounded tab is exactly when the list is most
		// likely to be stale, and browsers throttle timers while hidden.
		const onVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [refresh]);

	const value = useMemo<NewsState>(
		() => ({
			items: data.items,
			failed: data.failed ?? [],
			fetchedAt: data.fetchedAt,
			symbolDates: data.symbolDates ?? {},
			refreshing,
			live,
			refresh,
		}),
		[data, refreshing, live, refresh],
	);

	return <NewsCtx.Provider value={value}>{children}</NewsCtx.Provider>;
}

/** Null-safe: the calendar renders fine on a page with no rail. */
export function useNews(): NewsState | null {
	return useContext(NewsCtx);
}
