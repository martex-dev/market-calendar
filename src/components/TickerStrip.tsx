import { getUpcomingHighImpact } from '@/lib/db/events';
import { formatEventTime, todayET } from '@/lib/time';

/**
 * Quote-board strip across the top: the next High-impact events, in order.
 *
 * Always ET. This is a scheduling readout rather than a personal view, and
 * the market it describes runs on ET — converting it to the viewer's zone
 * would make "08:30" stop meaning "the release time" at a glance.
 */
function daysUntil(fromISO: string, toISO: string): number {
	const a = Date.UTC(
		...(fromISO.split('-').map(Number) as [number, number, number]),
	);
	const b = Date.UTC(
		...(toISO.split('-').map(Number) as [number, number, number]),
	);
	return Math.round((b - a) / 86_400_000);
}

function relative(days: number): string {
	if (days <= 0) return 'today';
	if (days === 1) return 'tomorrow';
	if (days < 7) return `in ${days}d`;
	return `in ${Math.round(days / 7)}w`;
}

export default async function TickerStrip() {
	const today = todayET();

	let events: Awaited<ReturnType<typeof getUpcomingHighImpact>> = [];
	try {
		events = await getUpcomingHighImpact(today, 10);
	} catch {
		// An empty database (fresh clone, before `npm run refresh`) must not
		// take down every page — the strip just does not render.
		return null;
	}

	if (events.length === 0) return null;

	return (
		<div className='ticker'>
			<div className='ticker-inner'>
				<div className='ticker-label'>
					<span className='ticker-dot' />
					High impact
				</div>
				{events.map((e) => {
					const d = daysUntil(today, e.date);
					return (
						<div className='ticker-item' key={e.id}>
							<span className='ticker-date mono'>
								{e.date.slice(5).replace('-', '/')}
							</span>
							<span className='ticker-name'>{e.title}</span>
							{e.etMinutes !== null && (
								<span className='ticker-date mono'>
									{formatEventTime(e.date, e.etMinutes, 'ET').replace(' ET', '')}
								</span>
							)}
							<span className='ticker-in mono'>{relative(d)}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
