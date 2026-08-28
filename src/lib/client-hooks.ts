'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * Hooks for values that only exist in the browser.
 *
 * Both are built on useSyncExternalStore rather than useState-in-an-effect,
 * which is the pattern src/components/EventTime.tsx already established here
 * and the reason is worth restating: useSyncExternalStore takes an EXPLICIT
 * server snapshot, so React renders the server value during SSR and hydration
 * and swaps to the client value afterwards — no mismatch, no cascading render
 * from a setState in an effect body.
 *
 * The alternative (`const [m, setM] = useState(false); useEffect(() => setM(true))`)
 * works but re-renders every consumer twice and is what the project's lint
 * config flags as `react-hooks/set-state-in-effect`.
 */

const noopSubscribe = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;

/** False on the server and through hydration, true afterwards. */
export function useIsClient(): boolean {
	return useSyncExternalStore(noopSubscribe, clientTrue, serverFalse);
}

/**
 * A ticking wall-clock, or null until the client takes over.
 *
 * Callers get null for the server render and must show a placeholder — which
 * is correct rather than annoying: the server genuinely does not know what
 * time it is where the reader is, and a countdown baked into the HTML would
 * be wrong by however long the response spent in flight.
 *
 * The snapshot is held in a ref so getSnapshot returns a STABLE value between
 * ticks. Returning Date.now() directly would hand React a new value on every
 * read and spin forever.
 */
export function useNow(intervalMs = 1000): number | null {
	const snapshot = useRef<number | null>(null);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			snapshot.current = Date.now();
			const id = setInterval(() => {
				snapshot.current = Date.now();
				onStoreChange();
			}, intervalMs);
			return () => clearInterval(id);
		},
		[intervalMs],
	);

	const getSnapshot = useCallback(() => {
		if (snapshot.current === null) snapshot.current = Date.now();
		return snapshot.current;
	}, []);

	const getServerSnapshot = useCallback(() => null, []);

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
