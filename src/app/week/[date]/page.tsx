import { notFound } from 'next/navigation';
import DayList from '@/components/DayList';
import Toolbar from '@/components/Toolbar';
import { getEventsInRange, groupByDate } from '@/lib/db/events';
import {
	addDays,
	formatDayHeading,
	isDateKey,
	startOfWeek,
	todayET,
	weekDays,
	type TimeMode,
} from '@/lib/time';

export const dynamic = 'force-dynamic';

function parseMode(raw: string | undefined): TimeMode {
	return raw === 'local' ? 'local' : 'ET';
}

export default async function WeekPage({
	params,
	searchParams,
}: {
	params: Promise<{ date: string }>;
	searchParams: Promise<{ tz?: string }>;
}) {
	const { date } = await params;
	const { tz } = await searchParams;

	if (!isDateKey(date)) notFound();

	const mode = parseMode(tz);
	const monday = startOfWeek(date);
	const days = weekDays(monday);
	const today = todayET();

	// One range query returns macro and earnings already interleaved.
	const events = await getEventsInRange(days[0], days[6]);
	const byDate = groupByDate(events, days);

	const qs = mode === 'local' ? '?tz=local' : '';
	const label = `${formatDayHeading(days[0]).replace(/^\w+, /, '').replace(/, \d{4}$/, '')} – ${formatDayHeading(days[6]).replace(/^\w+, /, '')}`;

	return (
		<>
			<Toolbar
				view='week'
				label={label}
				mode={mode}
				prevHref={`/week/${addDays(monday, -7)}${qs}`}
				nextHref={`/week/${addDays(monday, 7)}${qs}`}
				todayHref={`/week/${today}${qs}`}
				weekHref={`/week/${monday}${qs}`}
				dayHref={`/day/${today >= days[0] && today <= days[6] ? today : days[0]}${qs}`}
				modeHrefs={{
					ET: `/week/${monday}`,
					local: `/week/${monday}?tz=local`,
				}}
			/>

			{events.length === 0 && (
				<p className='notice'>
					No events stored for this week. Run{' '}
					<span className='mono'>npm run refresh</span> to populate the
					database, or step to a week inside the loaded window.
				</p>
			)}

			{days.map((d) => (
				<DayList
					key={d}
					date={d}
					events={byDate.get(d) ?? []}
					mode={mode}
					isToday={d === today}
				/>
			))}
		</>
	);
}
