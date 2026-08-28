/**
 * Which headline leads.
 *
 * A "Hot Story" panel has to make an editorial call, and this file is where
 * that call is made in the open. It is a fixed weighted sum — no model,
 * nothing learned, nothing tuned against outcomes — and every component it
 * scores is reported back to the UI so the panel can say WHY a story leads
 * rather than just asserting that it does.
 *
 * That is the same posture as the source stamps and the impact rationales: the
 * product's claim is that its judgements are inspectable. A black-box "top
 * story" would be the one element on the page you had to take on faith.
 *
 * NOT the same thing as an impact tag. CLAUDE.md fixes event impact to a
 * per-TYPE lookup and forbids a scoring model for it. That rule is about the
 * calendar's ranking of scheduled events, which must be stable and reviewable
 * per type. A news feed has no types to look up — every item is unique — so
 * ordering it needs a rule that reads the item. The rule is kept small,
 * explicit, and displayed.
 */

import type { NewsItem } from './index';

export interface RankedItem {
	item: NewsItem;
	score: number;
	/** Human-readable reasons, highest-contribution first. */
	reasons: string[];
}

/**
 * Topic weights.
 *
 * Ordered by how directly the topic drives the whole index rather than one
 * sector: policy rates first, then the two inflation-and-labour inputs the
 * Fed reacts to, then growth, then everything else. `markets` is weighted low
 * on purpose — it is the catch-all that keeps generic tape coverage eligible
 * without letting it lead.
 */
const TOPIC_WEIGHT: Record<string, number> = {
	fed: 5,
	inflation: 4,
	jobs: 4,
	growth: 3,
	consumer: 2,
	trade: 2,
	earnings: 2,
	markets: 1,
};

/** An agency publishing its own release outranks a report about it. */
const ISSUER_BONUS = 3;

/** Each additional outlet running the same topic in the window. */
const CORROBORATION_WEIGHT = 0.6;
const CORROBORATION_CAP = 3;

/** A story naming a company that reports inside the loaded calendar. */
const SYMBOL_BONUS = 2;

/**
 * Recency, as a multiplier rather than an addend.
 *
 * Additive recency lets a stale but heavily-weighted story sit at the top for
 * days. A decay multiplier means age erodes everything a story has going for
 * it, which is how a news desk actually behaves. Half-life is 12 hours: a
 * morning CPI story still leads that afternoon and has faded by the next day.
 */
const HALF_LIFE_HOURS = 12;

function recencyFactor(publishedAt: string | null, now: number): number {
	if (!publishedAt) return 0.3;
	const ageHours = (now - Date.parse(publishedAt)) / 3_600_000;
	if (!Number.isFinite(ageHours) || ageHours < 0) return 1;
	return Math.pow(0.5, ageHours / HALF_LIFE_HOURS);
}

/**
 * Score every item, best first.
 *
 * `now` is a parameter rather than a Date.now() call so the ordering is a pure
 * function of its inputs — the server and the client have to agree on which
 * story leads, or the panel would reshuffle on hydration.
 */
export function rankNews(items: NewsItem[], now: number): RankedItem[] {
	// How many DISTINCT outlets are covering each topic right now. Two wires
	// and an agency on the same subject is the strongest signal available here
	// that something actually happened.
	const outletsByTopic = new Map<string, Set<string>>();
	for (const n of items) {
		for (const t of n.topics) {
			if (!outletsByTopic.has(t)) outletsByTopic.set(t, new Set());
			outletsByTopic.get(t)!.add(n.source);
		}
	}

	const ranked = items.map((item) => {
		const reasons: { text: string; value: number }[] = [];

		const topicScore = item.topics.reduce(
			(sum, t) => sum + (TOPIC_WEIGHT[t] ?? 0),
			0,
		);
		if (topicScore > 0) {
			const named = item.topics
				.filter((t) => (TOPIC_WEIGHT[t] ?? 0) >= 3)
				.join(', ');
			reasons.push({
				text: named
					? `Covers ${named}, the topics that move the whole index`
					: 'Matches a tracked topic',
				value: topicScore,
			});
		}

		if (item.tier === 'primary') {
			reasons.push({
				text: `Published by ${item.sourceLabel} itself, not reported second-hand`,
				value: ISSUER_BONUS,
			});
		}

		const outlets = Math.max(
			0,
			...item.topics.map((t) => (outletsByTopic.get(t)?.size ?? 1) - 1),
		);
		const corroboration =
			Math.min(outlets, CORROBORATION_CAP) * CORROBORATION_WEIGHT;
		if (corroboration > 0) {
			reasons.push({
				text: `${outlets + 1} sources are covering this subject right now`,
				value: corroboration,
			});
		}

		if (item.symbols.length > 0) {
			reasons.push({
				text: `Names ${item.symbols.join(', ')}, reporting inside this calendar`,
				value: SYMBOL_BONUS,
			});
		}

		const base =
			topicScore +
			(item.tier === 'primary' ? ISSUER_BONUS : 0) +
			corroboration +
			(item.symbols.length > 0 ? SYMBOL_BONUS : 0);

		const factor = recencyFactor(item.publishedAt, now);

		return {
			item,
			score: base * factor,
			reasons: reasons
				.sort((a, b) => b.value - a.value)
				.slice(0, 3)
				.map((r) => r.text),
		};
	});

	return ranked.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		// Deterministic tiebreak, so the lead does not depend on feed order.
		return a.item.id < b.item.id ? -1 : 1;
	});
}

/** The single lead story, or null when there is nothing to lead with. */
export function hotStory(items: NewsItem[], now: number): RankedItem | null {
	return rankNews(items, now)[0] ?? null;
}
