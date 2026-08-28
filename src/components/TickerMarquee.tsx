'use client';

import { useState } from 'react';

/**
 * The scrolling top rail.
 *
 * One flat entry shape rather than a union of event/news props: the marquee
 * has no business knowing what a MarketEvent is. The server component
 * upstream flattens both into this, which keeps the animation code free of
 * domain logic and lets the strip carry a third kind of thing later without
 * touching this file.
 */
export interface TickerEntry {
	id: string;
	type: 'event' | 'news';
	/** Small leading badge: a date for events, a source stamp for news. */
	lead: string;
	text: string;
	/** Trailing note: "in 3d" for events, "2h ago" for news. */
	trail?: string;
	href?: string;
	tone?: 'high' | 'medium';
}

/* --------------------------------- marquee -------------------------------- */

function Entry({ entry }: { entry: TickerEntry }) {
	const body = (
		<>
			<span className={`mq-lead mono${entry.tone ? ` tone-${entry.tone}` : ''}`}>
				{entry.lead}
			</span>
			<span className='mq-text'>{entry.text}</span>
			{entry.trail && <span className='mq-trail mono'>{entry.trail}</span>}
		</>
	);

	return entry.href ? (
		<a
			className={`mq-item is-${entry.type} is-link`}
			href={entry.href}
			target='_blank'
			rel='noopener noreferrer'
		>
			{body}
		</a>
	) : (
		<span className={`mq-item is-${entry.type}`}>{body}</span>
	);
}

export default function TickerMarquee({ entries }: { entries: TickerEntry[] }) {
	const [paused, setPaused] = useState(false);

	if (entries.length === 0) return null;

	/*
	 * Speed is derived from content length, not fixed. A fixed duration makes
	 * a short strip crawl and a long one blur past; tying it to characters
	 * keeps the reading speed constant however many events are loaded.
	 * ~11 characters per second is a comfortable scan rate.
	 */
	const chars = entries.reduce(
		(n, e) => n + e.lead.length + e.text.length + (e.trail?.length ?? 0) + 6,
		0,
	);
	const duration = Math.max(36, Math.round(chars / 11));

	// The track holds the list TWICE and animates to -50%. At the end of the
	// cycle the second copy sits exactly where the first started, so the reset
	// is invisible. The clone is aria-hidden so it is not read out twice.
	return (
		<div className='ticker'>
			<div className='mq-label'>
				<span className='mq-label-dot' />
				Wire
			</div>
			<div
				className={`mq${paused ? ' is-paused' : ''}`}
				onMouseEnter={() => setPaused(true)}
				onMouseLeave={() => setPaused(false)}
				onFocusCapture={() => setPaused(true)}
				onBlurCapture={() => setPaused(false)}
			>
				<div
					className='mq-track'
					style={{ ['--mq-duration' as string]: `${duration}s` }}
				>
					<div className='mq-run'>
						{entries.map((e) => (
							<Entry key={e.id} entry={e} />
						))}
					</div>
					<div className='mq-run' aria-hidden='true'>
						{entries.map((e) => (
							<Entry key={`clone-${e.id}`} entry={e} />
						))}
					</div>
				</div>
				<button
					type='button'
					className='mq-toggle mono'
					aria-pressed={paused}
					aria-label={paused ? 'Resume ticker' : 'Pause ticker'}
					onClick={() => setPaused((p) => !p)}
				>
					{paused ? '▶' : '❚❚'}
				</button>
			</div>
		</div>
	);
}
