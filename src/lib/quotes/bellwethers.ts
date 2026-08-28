/**
 * The Bellwethers list — the equity answer to a forex board's "Majors".
 *
 * WHY "BELLWETHERS" AND NOT "MAJORS". A forex board's majors are a closed,
 * universally agreed set: seven pairs, everyone lists the same seven. Equities
 * have no such canon, so borrowing the word would imply an authority this list
 * does not have. "Bellwether" is the actual term for an instrument that leads
 * the market, and it is honest about being a judgement call.
 *
 * Same discipline as src/lib/impact.ts and src/lib/news/feeds.ts: a fixed,
 * hand-assembled table with a stated reason per entry, kept apart from the
 * fetching code.
 *
 * THE INDEX ROWS ARE ETFs, ON PURPOSE. NASDAQ's quote API only carries its own
 * indices (COMP and NDX resolve; SPX, INDU, RUT and VIX all return "Symbol not
 * exists"), and even those come back `isRealTime: false` with a date and no
 * clock time. The tracking ETFs quote real-time on the same endpoint, so the
 * strip uses those and labels them as what they are. A row that says "S&P 500"
 * and moves once a day would be worse than one that says "SPY" and is live.
 */

export type QuoteAssetClass = 'stocks' | 'etf' | 'index';

export type BellwetherGroup = 'index' | 'megacap';

export interface Bellwether {
	/** NASDAQ's symbol, used in the request path. */
	symbol: string;
	/** Which endpoint variant the symbol lives under. Wrong value = error. */
	assetClass: QuoteAssetClass;
	/** What this instrument stands for, shown under the ticker. */
	label: string;
	group: BellwetherGroup;
	/** Why it is on the list. */
	rationale: string;
}

export const BELLWETHERS: Bellwether[] = [
	{
		symbol: 'SPY',
		assetClass: 'etf',
		label: 'S&P 500',
		group: 'index',
		rationale:
			'The broad US tape. This calendar filters earnings to S&P 500 constituents, so this is the index the product is about.',
	},
	{
		symbol: 'QQQ',
		assetClass: 'etf',
		label: 'Nasdaq-100',
		group: 'index',
		rationale:
			'The other constituent list behind the earnings half of the calendar, and the one that moves most on rate expectations.',
	},
	{
		symbol: 'DIA',
		assetClass: 'etf',
		label: 'Dow 30',
		group: 'index',
		rationale:
			'Price-weighted and narrow, so it diverges from the S&P often enough to be worth watching next to it rather than instead of it.',
	},
	{
		symbol: 'IWM',
		assetClass: 'etf',
		label: 'Russell 2000',
		group: 'index',
		rationale:
			'Small caps. The clearest read on how the macro rows land on domestic, rate-sensitive companies rather than on mega-cap earnings.',
	},
	{
		symbol: 'NVDA',
		assetClass: 'stocks',
		label: 'NVIDIA',
		group: 'megacap',
		rationale:
			'Largest index weight. A single print here moves the S&P and Nasdaq-100 directly — which is the same reasoning that puts it in the High earnings tier.',
	},
	{
		symbol: 'AAPL',
		assetClass: 'stocks',
		label: 'Apple',
		group: 'megacap',
		rationale: 'Top-three index weight.',
	},
	{
		symbol: 'MSFT',
		assetClass: 'stocks',
		label: 'Microsoft',
		group: 'megacap',
		rationale: 'Top-three index weight.',
	},
	{
		symbol: 'GOOGL',
		assetClass: 'stocks',
		label: 'Alphabet',
		group: 'megacap',
		rationale: 'Top-five index weight.',
	},
	{
		symbol: 'AMZN',
		assetClass: 'stocks',
		label: 'Amazon',
		group: 'megacap',
		rationale:
			'Top-five index weight, and the cleanest single-name read on the consumer rows (retail sales, PCE).',
	},
	{
		symbol: 'META',
		assetClass: 'stocks',
		label: 'Meta',
		group: 'megacap',
		rationale: 'Top-ten index weight.',
	},
	{
		symbol: 'TSLA',
		assetClass: 'stocks',
		label: 'Tesla',
		group: 'megacap',
		rationale:
			'Top-ten index weight and by far the most volatile of them, so it leads the tape on risk-on and risk-off days.',
	},
];

export function bellwetherFor(symbol: string): Bellwether | undefined {
	return BELLWETHERS.find((b) => b.symbol === symbol);
}
