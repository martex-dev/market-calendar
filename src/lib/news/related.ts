/**
 * Headline -> calendar row lookup, the reverse of src/lib/news/topics.ts.
 *
 * topics.ts answers "what is this story about" at fetch time. This answers
 * "which stories are about THIS row" at render time, which is what makes the
 * expandable row worth opening: the CPI print on the 11th shows the CPI
 * coverage that already ran, in place, rather than making you scan the rail.
 *
 * Split into its own module because it is the one piece of the news layer the
 * client bundle needs — the fetching and parsing stay on the server.
 */

import { TOPICS } from './topics';
import type { NewsItem } from './index';
import type { MarketEvent } from '../types';

/** Event ids are `kind:date:key`; the classification key is the tail. */
function keyOf(event: MarketEvent): string {
	const parts = event.id.split(':');
	return parts.length >= 3 ? parts.slice(2).join(':') : '';
}

/**
 * Stories tied to one calendar row.
 *
 * Macro rows match through the topic table (a CPI row picks up every headline
 * tagged `inflation`); earnings rows match on the ticker itself, which is the
 * tighter of the two and needs no topic. Capped, because the panel this feeds
 * is a footnote on a row and not a second news rail.
 */
export function relatedNews(
	event: MarketEvent,
	items: NewsItem[],
	limit = 4,
): NewsItem[] {
	if (event.kind === 'earnings') {
		if (!event.symbol) return [];
		return items.filter((n) => n.symbols.includes(event.symbol!)).slice(0, limit);
	}

	const key = keyOf(event);
	const topicKeys = TOPICS.filter((t) => t.eventKeys.includes(key)).map(
		(t) => t.key,
	);
	if (topicKeys.length === 0) return [];

	return items
		.filter((n) => n.topics.some((t) => topicKeys.includes(t)))
		.slice(0, limit);
}
