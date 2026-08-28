'use client';

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from 'react';
import type { EventKind, Impact } from '@/lib/types';

/**
 * Filter state shared by the calendar and the news rail.
 *
 * WHY CONTEXT AND NOT THE URL. Every other piece of view state in this app is
 * a URL parameter — the week, the day, the ET/Local toggle — because those
 * are things you share a link to. Filtering is different: it is a momentary
 * "show me only the Fed rows" gesture, and routing it through the URL would
 * mean a server round trip on every keystroke of a search box against a page
 * that is already `force-dynamic`.
 *
 * The provider also lets the two panels talk. Clicking NVDA on a headline in
 * the rail filters the calendar to Nvidia's earnings row, which is the whole
 * argument for putting news next to a schedule instead of on its own page.
 */

export interface FilterState {
	query: string;
	setQuery: (q: string) => void;
	kinds: Set<EventKind>;
	toggleKind: (k: EventKind) => void;
	impacts: Set<Impact>;
	toggleImpact: (i: Impact) => void;
	/** Topic key from src/lib/news/topics.ts, or null for "everything". */
	topic: string | null;
	setTopic: (t: string | null) => void;
	active: boolean;
	reset: () => void;
}

const ALL_KINDS: EventKind[] = ['macro', 'earnings'];
const ALL_IMPACTS: Impact[] = ['High', 'Medium', 'Low'];

const FilterCtx = createContext<FilterState | null>(null);

/** Toggling the last member of a set turns everything back on, never off. */
function toggleIn<T>(set: Set<T>, value: T, all: T[]): Set<T> {
	const next = new Set(set);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	// An empty filter set would render a blank calendar with no way back
	// except a Reset the user has to notice. Collapsing to "all" instead
	// makes the control impossible to get stuck in.
	return next.size === 0 ? new Set(all) : next;
}

export function FilterProvider({ children }: { children: React.ReactNode }) {
	const [query, setQuery] = useState('');
	const [kinds, setKinds] = useState<Set<EventKind>>(new Set(ALL_KINDS));
	const [impacts, setImpacts] = useState<Set<Impact>>(new Set(ALL_IMPACTS));
	const [topic, setTopic] = useState<string | null>(null);

	const reset = useCallback(() => {
		setQuery('');
		setKinds(new Set(ALL_KINDS));
		setImpacts(new Set(ALL_IMPACTS));
		setTopic(null);
	}, []);

	const value = useMemo<FilterState>(
		() => ({
			query,
			setQuery,
			kinds,
			toggleKind: (k) => setKinds((s) => toggleIn(s, k, ALL_KINDS)),
			impacts,
			toggleImpact: (i) => setImpacts((s) => toggleIn(s, i, ALL_IMPACTS)),
			topic,
			setTopic,
			active:
				query.trim() !== '' ||
				kinds.size !== ALL_KINDS.length ||
				impacts.size !== ALL_IMPACTS.length,
			reset,
		}),
		[query, kinds, impacts, topic, reset],
	);

	return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

export function useFilters(): FilterState {
	const ctx = useContext(FilterCtx);
	if (!ctx) {
		throw new Error('useFilters must be used inside <FilterProvider>');
	}
	return ctx;
}
