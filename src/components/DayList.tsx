'use client';

import { useState } from 'react';
import EventTime from './EventTime';
import { useNews } from './NewsContext';
import { formatDayHeading, timeAgo } from '@/lib/time';
import type { TimeMode } from '@/lib/time';
import { direction, sourceMeta } from '@/lib/sources';
import { eventDetail } from '@/lib/rationale';
import { relatedNews } from '@/lib/news/related';
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
 *
 * Rows expand. The closed row is the schedule; the open row is the receipt —
 * the impact rationale verbatim from src/lib/impact.ts, what the source can
 * and cannot tell us, a link to the issuing agency, and any coverage of that
 * release from the news rail. CLAUDE.md asks for classifications that can be
 * reviewed without reading fetch code, and this is where a reader who is not
 * going to open the repository gets to do that.
 */

function RowDetail({ event }: { event: MarketEvent }) {
	const detail = eventDetail(event);
	const news = useNews();
	const related = news ? relatedNews(event, news.items) : [];

	return (
		<div className='row-detail'>
			<div className='rd-grid'>
				<div className='rd-block'>
					<h4>Why {event.impact}</h4>
					<p>{detail.rationale}</p>
				</div>

				<div className='rd-block'>
					<h4>Provenance</h4>
					<p>{detail.sourceDetail}</p>
					{detail.notes.map((n) => (
						<p className='rd-note' key={n}>
							{n}
						</p>
					))}
					{detail.sourceUrl && (
						<a
							className='rd-link mono'
							href={detail.sourceUrl}
							target='_blank'
							rel='noopener noreferrer'
						>
							Open source ↗
						</a>
					)}
				</div>

				<div className='rd-block'>
					<h4>
						Coverage
						{related.length > 0 && (
							<span className='rd-count mono'>{related.length}</span>
						)}
					</h4>
					{related.length === 0 ? (
						<p className='rd-note'>
							Nothing in the current feed window matches this row.
						</p>
					) : (
						<ul className='rd-news'>
							{related.map((n) => (
								<li key={n.id}>
									<a href={n.url} target='_blank' rel='noopener noreferrer'>
										{n.title}
									</a>
									<span className='rd-news-meta mono'>
										{n.sourceLabel}
										{n.publishedAt ? ` · ${timeAgo(n.publishedAt)}` : ''}
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}

export default function DayList({
	events,
	mode,
	isToday,
	date,
}: {
	date: string;
	events: MarketEvent[];
	mode: TimeMode;
	isToday: boolean;
}) {
	// One open row per day. Opening a second closes the first, which keeps a
	// week from turning into a wall of expanded panels.
	const [openId, setOpenId] = useState<string | null>(null);

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
						const open = openId === e.id;

						return (
							<div className='row-wrap' key={e.id}>
								<button
									type='button'
									className={`row kind-${e.kind}${open ? ' is-open' : ''}`}
									aria-expanded={open}
									onClick={() => setOpenId(open ? null : e.id)}
								>
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

									<span className='row-caret' aria-hidden='true'>
										›
									</span>
								</button>

								{open && <RowDetail event={e} />}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
