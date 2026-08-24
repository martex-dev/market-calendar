import type { Metadata } from 'next';
import { JetBrains_Mono, Public_Sans } from 'next/font/google';
import TickerStrip from '@/components/TickerStrip';
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
		'Macro releases and major earnings for US stocks, merged into one day-by-day calendar ranked by impact.',
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang='en' className={`${sans.variable} ${mono.variable}`}>
			<body>
				<TickerStrip />
				<div className='wrap'>
					<header className='site'>
						<div>
							<h1>
								<span className='brandmark mono'>MC</span>
								Market Calendar
							</h1>
							<p className='tag'>
								Macro releases and index-constituent earnings, merged into
								one timeline and ranked by impact.
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
					{children}
					<footer className='site'>
						<div>
							<strong>Sources.</strong> Macro release dates from FRED
							(St.&nbsp;Louis Fed) <span className='mono'>release/dates</span>.
							FOMC decision dates from federalreserve.gov. Earnings from
							NASDAQ&apos;s public calendar, filtered to S&amp;P&nbsp;500 and
							Nasdaq-100 constituents.
						</div>
						<div>
							<strong>Read the stamps.</strong> Every row carries the source it
							came from. Times are scheduled, not guaranteed. Macro rows have no
							forecast because FRED publishes no consensus estimates.
						</div>
						<div>
							Not investment advice. Informational use only.
						</div>
					</footer>
				</div>
			</body>
		</html>
	);
}
