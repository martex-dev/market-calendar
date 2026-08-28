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
	type TimeMode,
} from '@/lib/time';

export const dynamic = 'force-dynamic';

function parseMode(raw: string | undefined): TimeMode {
	return raw === 'local' ? 'local' : 'ET';
}

export default async function DayPage({
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
	const today = todayET();

	const [events, upcoming] = await Promise.all([
		getEventsInRange(date, date),
		getUpcomingHighImpact(today, 1).catch(() => []),
	]);

	const qs = mode === 'local' ? '?tz=local' : '';
	const macro = events.filter((e) => e.kind === 'macro').length;

	const nav = {
		prev: `/day/${addDays(date, -1)}${qs}`,
		next: `/day/${addDays(date, 1)}${qs}`,
		today: `/day/${today}${qs}`,
		week: `/week/${startOfWeek(date)}${qs}`,
		day: `/day/${date}${qs}`,
	};

	return (
		<>
			<Toolbar
				view='day'
				label={formatDayHeading(date)}
				mode={mode}
				prevHref={nav.prev}
				nextHref={nav.next}
				todayHref={nav.today}
				weekHref={nav.week}
				dayHref={nav.day}
				modeHrefs={{ ET: `/day/${date}`, local: `/day/${date}?tz=local` }}
			/>

			<StatBand
				scopeLabel='This day'
				counts={{
					total: events.length,
					high: events.filter((e) => e.impact === 'High').length,
					macro,
					earnings: events.length - macro,
				}}
				nextHigh={upcoming[0] ?? null}
			/>

			<CalendarView
				days={[date]}
				events={events}
				mode={mode}
				today={today}
				nav={nav}
			/>
		</>
	);
}
