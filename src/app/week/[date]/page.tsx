import { notFound } from 'next/navigation';
import CalendarView from '@/components/CalendarView';
import StatBand from '@/components/StatBand';
import Toolbar from '@/components/Toolbar';
import { getEventsInRange, getUpcomingHighImpact } from '@/lib/db/events';
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
	// The countdown target is looked up separately from `today` rather than
	// from this week's rows, so paging back to March still counts down to the
	// next real event instead of one that has already happened.
	const [events, upcoming] = await Promise.all([
		getEventsInRange(days[0], days[6]),
		getUpcomingHighImpact(today, 1).catch(() => []),
	]);

	const qs = mode === 'local' ? '?tz=local' : '';
	const label = `${formatDayHeading(days[0]).replace(/^\w+, /, '').replace(/, \d{4}$/, '')} – ${formatDayHeading(days[6]).replace(/^\w+, /, '')}`;

	const macro = events.filter((e) => e.kind === 'macro').length;

	const nav = {
		prev: `/week/${addDays(monday, -7)}${qs}`,
		next: `/week/${addDays(monday, 7)}${qs}`,
		today: `/week/${today}${qs}`,
		week: `/week/${monday}${qs}`,
		day: `/day/${today >= days[0] && today <= days[6] ? today : days[0]}${qs}`,
	};

	return (
		<>
			<Toolbar
				view='week'
				label={label}
				mode={mode}
				prevHref={nav.prev}
				nextHref={nav.next}
				todayHref={nav.today}
				weekHref={nav.week}
				dayHref={nav.day}
				modeHrefs={{
					ET: `/week/${monday}`,
					local: `/week/${monday}?tz=local`,
				}}
			/>

			<StatBand
				scopeLabel='This week'
				counts={{
					total: events.length,
					high: events.filter((e) => e.impact === 'High').length,
					macro,
					earnings: events.length - macro,
				}}
				nextHigh={upcoming[0] ?? null}
			/>

			{events.length === 0 && (
				<p className='notice'>
					No events stored for this week. Run{' '}
					<span className='mono'>npm run refresh</span> to populate the
					database, or step to a week inside the loaded window.
				</p>
			)}

			<CalendarView
				days={days}
				events={events}
				mode={mode}
				today={today}
				nav={nav}
			/>
		</>
	);
}
