import type { Metadata } from 'next';
import { JetBrains_Mono, Public_Sans } from 'next/font/google';
import BellwetherBar from '@/components/BellwetherBar';
import TickerStrip from '@/components/TickerStrip';
import NewsDesk from '@/components/NewsDesk';
import { FilterProvider } from '@/components/FilterContext';
import { NewsProvider } from '@/components/NewsContext';
import { getMarketNews, type NewsResult } from '@/lib/news';
import { getEventsInRange } from '@/lib/db/events';
import { addDays, todayET } from '@/lib/time';
import './globals.css';

/**
 * Monospace for every number so digits align down a column, the way a quote
 * board does. Public Sans (not Inter) for labels and prose.
 */
const mono = JetBrains_Mono({
	variable: '--font-mono',
	subsets: ['latin'],
	weight: ['400', '500', '700'],
});

const sans = Public_Sans({
	variable: '--font-sans',
	subsets: ['latin'],
	weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
	title: 'Market Calendar',
	description:
		'Live quotes for the stocks that lead the market, the economic news that moves them, and a day-by-day calendar of macro releases and major earnings ranked by impact.',
};

/**
 * News is fetched in the LAYOUT, not the page.
 *
 * The desk is the same on the week view and the day view, and fetching it per
 * page would re-read six feeds on every navigation between them. Layouts do
 * not re-render across sibling route changes, so this fetch happens once per
 * session and then the client provider keeps it current on its own timer.
 *
 * It cannot throw: a broken feed leg must never be the reason the calendar
 * fails to render.
 *
 * The earnings rows go in so headlines come back carrying ticker tags. The
 * window is wider than any single view (a week either side of a month and a
 * half) because a story about a company reporting in October is still a story
 * about this calendar while you are looking at September — and it is the same
 * indexed date-range query every page already runs.
 */
async function loadNews(): Promise<NewsResult> {
	try {
		const today = todayET();
		const events = await getEventsInRange(
			addDays(today, -7),
			addDays(today, 45),
		).catch(() => []);
		return await getMarketNews({ events, limit: 40 });
	} catch (err) {
		return {
			items: [],
			failed: [{ source: 'all', error: String(err).slice(0, 200) }],
			fetchedAt: new Date().toISOString(),
			symbolDates: {},
		};
	}
}

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const news = await loadNews();

	/*
	 * Reading down the page: the live tape, the wire, then what is scheduled.
	 * Prices change by the second, headlines by the hour, the calendar once a
	 * day — so the layout is ordered by how fast each thing moves, and the
	 * quote board is the only part pinned to the top of the viewport.
	 *
	 * FilterProvider wraps everything because all three surfaces write to it:
	 * a bellwether tile, a ticker chip on a headline, and the calendar's own
	 * search box are the same filter.
	 */
	return (
		<html lang='en' className={`${sans.variable} ${mono.variable}`}>
			<body>
				<FilterProvider>
					<BellwetherBar />
					<TickerStrip />

					<div className='wrap'>
						<header className='site'>
							<div>
								<h1>
									<span className='brandmark mono'>MC</span>
									Market Calendar
								</h1>
								<p className='tag'>
									Macro releases, index-constituent earnings, and the economic
									news around them — one timeline, ranked by impact.
								</p>
							</div>
							<div className='legend'>
								<span>
									<i style={{ background: 'var(--macro)' }} />
									Macro
								</span>
								<span>
									<i style={{ background: 'var(--earnings)' }} />
									Earnings
								</span>
								<span>
									<i style={{ background: 'var(--high)' }} />
									High
								</span>
								<span>
									<i style={{ background: 'var(--medium)' }} />
									Medium
								</span>
								<span>
									<i style={{ background: 'var(--low)' }} />
									Low
								</span>
							</div>
						</header>

						<NewsProvider initial={news}>
							<NewsDesk />
							<main>{children}</main>
						</NewsProvider>

						<footer className='site'>
							<div>
								<strong>Sources.</strong> Macro release dates from FRED
								(St.&nbsp;Louis Fed) <span className='mono'>release/dates</span>.
								FOMC decision dates from federalreserve.gov. Earnings and live
								quotes from NASDAQ&apos;s public API, filtered to
								S&amp;P&nbsp;500 and Nasdaq-100 constituents. Headlines from six
								public RSS feeds — the Federal Reserve, BEA, and Census
								directly, plus CNBC and MarketWatch.
							</div>
							<div>
								<strong>Read the stamps.</strong> Every row and every headline
								carries the source it came from, and agency releases are stamped
								apart from wire coverage. Open any row for the impact rationale
								verbatim, or the Hot Story panel for why that story leads. Times
								are scheduled, not guaranteed. Macro rows have no forecast
								because FRED publishes no consensus estimates.
							</div>
							<div>
								<strong>Index rows are tracking ETFs.</strong> NASDAQ&apos;s
								quote API carries only its own indices, and only end-of-day, so
								the S&amp;P 500, Dow and Russell tiles quote SPY, DIA and IWM —
								live, and labelled as what they are.
							</div>
							<div>
								<strong>Keys.</strong>{' '}
								<span className='mono'>←</span> <span className='mono'>→</span>{' '}
								step the range, <span className='mono'>t</span> today,{' '}
								<span className='mono'>w</span> / <span className='mono'>d</span>{' '}
								switch view, <span className='mono'>/</span> filter.
							</div>
							<div>Not investment advice. Informational use only.</div>
						</footer>
					</div>
				</FilterProvider>
			</body>
		</html>
	);
}
