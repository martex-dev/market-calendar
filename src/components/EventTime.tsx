'use client';

import { useIsClient } from '@/lib/client-hooks';
import { formatEventTime, type TimeMode } from '@/lib/time';

/**
 * Renders one event's time, in ET or the viewer's local zone.
 *
 * Local time can only be resolved in the browser — the server has no idea
 * what zone the viewer is in, so server-rendering 'local' would bake in the
 * server's zone and then mismatch on hydration. useIsClient (see
 * src/lib/client-hooks.ts) expresses exactly that: an explicit server
 * snapshot of false, a client snapshot of true, so React renders ET during
 * SSR and hydration and switches to local afterwards.
 *
 * If JS never runs, the viewer still gets correct ET times.
 */
export default function EventTime({
	date,
	etMinutes,
	mode,
}: {
	date: string;
	etMinutes: number | null;
	mode: TimeMode;
}) {
	const isClient = useIsClient();

	return (
		<span className='time'>
			{formatEventTime(date, etMinutes, isClient ? mode : 'ET')}
		</span>
	);
}
