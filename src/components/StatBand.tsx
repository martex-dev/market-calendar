'use client';

import { useNow } from '@/lib/client-hooks';
import { etWallClockToInstant } from '@/lib/time';
import type { MarketEvent } from '@/lib/types';

/**
 * The band under the header: what is in view, and how long until the next
 * thing that can actually move the index.
 *
 * The countdown is the one number on this page that is not a schedule — it is
 * the schedule minus now. That is worth a live second hand, because "CPI in
 * 3d" and "CPI in 04:12:07" are different pieces of information and only the
 * second one tells you whether to still be at your desk.
 */

/** The instant a row lands, in real time. */
function instantFor(event: MarketEvent): Date {
	// Untimed rows (NASDAQ gives no clock time for many earnings) are pinned
	// to the 09:30 ET open. Stated rather than hidden: the countdown for those
	// is "until the trading day it lands in", not "until the print".
	return etWallClockToInstant(event.date, event.etMinutes ?? 9 * 60 + 30);
}

function split(ms: number) {
	const s = Math.max(0, Math.floor(ms / 1000));
	return {
		days: Math.floor(s / 86400),
		hours: Math.floor((s % 86400) / 3600),
		mins: Math.floor((s % 3600) / 60),
		secs: s % 60,
	};
}

const pad = (n: number) => String(n).padStart(2, '0');

function Countdown({ event }: { event: MarketEvent }) {
	// Null through SSR and hydration: the server cannot know the viewer's
	// clock, and a countdown rendered into the HTML is already wrong by the
	// time it arrives.
	const now = useNow(1000);

	if (now === null) return <span className='cd mono'>··:··:··</span>;

	const delta = instantFor(event).getTime() - now;
	if (delta <= 0) return <span className='cd mono is-live'>underway</span>;

	const { days, hours, mins, secs } = split(delta);

	return (
		<span className='cd mono'>
			{days > 0 && <span className='cd-d'>{days}d </span>}
			{pad(hours)}:{pad(mins)}:{pad(secs)}
		</span>
	);
}

export interface BandCounts {
	total: number;
	high: number;
	macro: number;
	earnings: number;
}

export default function StatBand({
	counts,
	nextHigh,
	scopeLabel,
}: {
	counts: BandCounts;
	nextHigh: MarketEvent | null;
	scopeLabel: string;
}) {
	return (
		<div className='band'>
			<div className='band-next'>
				<span className='band-k'>Next high impact</span>
				{nextHigh ? (
					<>
						<span className='band-title'>{nextHigh.title}</span>
						<Countdown event={nextHigh} />
					</>
				) : (
					<span className='band-title band-none'>
						Nothing High-impact in the loaded window
					</span>
				)}
			</div>

			<div className='band-stats'>
				<div className='band-stat'>
					<span className='band-n mono'>{counts.total}</span>
					<span className='band-k'>{scopeLabel}</span>
				</div>
				<div className='band-stat is-high'>
					<span className='band-n mono'>{counts.high}</span>
					<span className='band-k'>High</span>
				</div>
				<div className='band-stat is-macro'>
					<span className='band-n mono'>{counts.macro}</span>
					<span className='band-k'>Macro</span>
				</div>
				<div className='band-stat is-earnings'>
					<span className='band-n mono'>{counts.earnings}</span>
					<span className='band-k'>Earnings</span>
				</div>
			</div>
		</div>
	);
}
