import Link from 'next/link';
import type { TimeMode } from '@/lib/time';

/**
 * Navigation, view switch, and the ET/Local toggle.
 *
 * The toggle is a URL parameter rather than client state so a shared link
 * preserves the choice and the pages stay server-rendered.
 */
export default function Toolbar({
	view,
	prevHref,
	nextHref,
	todayHref,
	label,
	mode,
	weekHref,
	dayHref,
	modeHrefs,
}: {
	view: 'week' | 'day';
	prevHref: string;
	nextHref: string;
	todayHref: string;
	label: string;
	mode: TimeMode;
	weekHref: string;
	dayHref: string;
	modeHrefs: { ET: string; local: string };
}) {
	return (
		<div className='toolbar'>
			<div className='group'>
				<div className='seg'>
					<Link href={prevHref} aria-label='Previous'>
						←
					</Link>
					<Link href={todayHref}>Today</Link>
					<Link href={nextHref} aria-label='Next'>
						→
					</Link>
				</div>
				<span className='range mono'>{label}</span>
			</div>

			<div className='group'>
				<div className='seg'>
					<Link
						href={weekHref}
						aria-current={view === 'week' ? 'page' : undefined}
					>
						Week
					</Link>
					<Link
						href={dayHref}
						aria-current={view === 'day' ? 'page' : undefined}
					>
						Day
					</Link>
				</div>
				<div className='seg'>
					<Link href={modeHrefs.ET} aria-pressed={mode === 'ET'}>
						ET
					</Link>
					<Link href={modeHrefs.local} aria-pressed={mode === 'local'}>
						Local
					</Link>
				</div>
			</div>
		</div>
	);
}
