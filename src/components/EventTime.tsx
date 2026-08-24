'use client';

import { useSyncExternalStore } from 'react';
import { formatEventTime, type TimeMode } from '@/lib/time';

/**
 * Renders one event's time, in ET or the viewer's local zone.
 *
 * Local time can only be resolved in the browser — the server has no idea
 * what zone the viewer is in, so server-rendering 'local' would bake in the
 * server's zone and then mismatch on hydration.
 *
 * useSyncExternalStore is the clean way to express "this value differs
 * between server and client": it takes an explicit server snapshot (false)
 * and client snapshot (true), so React renders ET on the server and during
 * hydration, then switches to local on the client without a mismatch and
 * without setState-in-an-effect. The store never actually changes, so the
 * subscribe callback is a no-op.
 *
 * If JS never runs, the viewer still gets correct ET times.
 */
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function EventTime({
	date,
	etMinutes,
	mode,
}: {
	date: string;
	etMinutes: number | null;
	mode: TimeMode;
}) {
	const isClient = useSyncExternalStore(
		subscribe,
		getClientSnapshot,
		getServerSnapshot,
	);

	return (
		<span className='time'>
			{formatEventTime(date, etMinutes, isClient ? mode : 'ET')}
		</span>
	);
}
