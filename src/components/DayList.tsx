import EventTime from './EventTime';
import { formatDayHeading } from '@/lib/time';
import type { TimeMode } from '@/lib/time';
import { direction, sourceMeta } from '@/lib/sources';
import type { MarketEvent } from '@/lib/types';

const SESSION_LABEL: Record<MarketEvent['session'], string> = {
	premarket: 'pre-mkt',
	intraday: 'intraday',
	afterhours: 'after hrs',
	unspecified: '',
};

/**
 * One day's merged events.
 *
 * Macro and earnings rows share one table with one ordering. The only
 * distinction is a 3px left border and the source stamp — they are never
 * grouped, sectioned, or tabbed apart, because a single interleaved list is
 * the entire point of the product (CLAUDE.md).
 */
export default function DayList({
	date,
	events,
	mode,
	isToday,
}: {
	date: string;
	events: MarketEvent[];
	mode: TimeMode;
	isToday: boolean;
}) {
	const heading = formatDayHeading(date);
	const [dow, rest] = heading.split(', ');
	const macro = events.filter((e) => e.kind === 'macro').length;
	const earnings = events.length - macro;
	const high = events.filter((e) => e.impact === 'High').length;

	return (
		<section
			className={[
				'day',
				isToday ? 'today' : '',
				events.length === 0 ? 'is-empty' : '',
			]
				.filter(Boolean)
				.join(' ')}
		>
			<div className='day-head'>
				<h2 className='day-date'>
					<span className='day-dow'>{dow}</span>
					<span className='day-full mono'>{rest}</span>
					{isToday && <span className='today-flag'>Today</span>}
				</h2>

				<div className='day-meta mono'>
					{events.length === 0 ? (
						<span>nothing scheduled</span>
					) : (
						<>
							{high > 0 && (
								<span className='pip'>
									<i style={{ background: 'var(--high)' }} />
									{high} high
								</span>
							)}
							{macro > 0 && (
								<span className='pip'>
									<i style={{ background: 'var(--macro)' }} />
									{macro} macro
								</span>
							)}
							{earnings > 0 && (
								<span className='pip'>
									<i style={{ background: 'var(--earnings)' }} />
									{earnings} earnings
								</span>
							)}
						</>
					)}
				</div>
			</div>

			{events.length === 0 ? null : (
				<div className='rows'>
					{events.map((e) => {
						const src = sourceMeta(e.source);
						const fDir = direction(e.forecast);
						const pDir = direction(e.previous);
						const session = SESSION_LABEL[e.session];

						return (
							<div className={`row kind-${e.kind}`} key={e.id}>
								<div
									className={`cell-time mono${e.etMinutes === null ? ' none' : ''}`}
								>
									<EventTime
										date={e.date}
										etMinutes={e.etMinutes}
										mode={mode}
									/>
									{session && <span className='session'>{session}</span>}
								</div>

								<span className={`chip ${e.impact}`}>{e.impact}</span>

								<div className='cell-event'>
									<div className='event-name'>
										<span>{e.title}</span>
										{e.symbol && <span className='sym mono'>{e.symbol}</span>}
									</div>
								</div>

								<div className='nums'>
									<div
										className={`num mono${e.forecast ? '' : ' empty'}${fDir ? ` ${fDir}` : ''}`}
									>
										<span className='lbl'>Forecast</span>
										{e.forecast ?? '—'}
									</div>
									<div
										className={`num mono${e.previous ? '' : ' empty'}${pDir ? ` ${pDir}` : ''}`}
									>
										<span className='lbl'>Previous</span>
										{e.previous ?? '—'}
									</div>
								</div>

								<span
									className={`stamp mono src-${e.source}`}
									title={src.detail}
								>
									{src.label}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
