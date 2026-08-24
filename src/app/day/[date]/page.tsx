import { notFound } from 'next/navigation';
import DayList from '@/components/DayList';
import Toolbar from '@/components/Toolbar';
import { getEventsInRange } from '@/lib/db/events';
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
	const events = await getEventsInRange(date, date);
	const qs = mode === 'local' ? '?tz=local' : '';

	return (
		<>
			<Toolbar
				view='day'
				label={formatDayHeading(date)}
				mode={mode}
				prevHref={`/day/${addDays(date, -1)}${qs}`}
				nextHref={`/day/${addDays(date, 1)}${qs}`}
				todayHref={`/day/${today}${qs}`}
				weekHref={`/week/${startOfWeek(date)}${qs}`}
				dayHref={`/day/${date}${qs}`}
				modeHrefs={{ ET: `/day/${date}`, local: `/day/${date}?tz=local` }}
			/>

			<DayList
				date={date}
				events={events}
				mode={mode}
				isToday={date === today}
			/>
		</>
	);
}
