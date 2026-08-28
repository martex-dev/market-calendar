/**
 * Builds the shareable artifact: `npm run artifact`.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND REACT APP:
 *
 * An artifact is a single static HTML file — it cannot run the Next.js server
 * or query the database. The obvious approach is to rebuild the calendar as a
 * separate React/Tailwind project, but that means writing the design twice and
 * letting the two copies drift apart.
 *
 * Instead this script emits the artifact FROM the real app's own assets: it
 * inlines src/app/globals.css verbatim and reproduces the same DOM structure
 * and class names the React components render. One stylesheet, one set of
 * design decisions. Restyle the app and re-run this — the artifact follows.
 *
 * The trade-off, stated plainly: the artifact carries a frozen SNAPSHOT of the
 * event data taken at export time. It does not refresh. The live Next.js app
 * is the thing that stays current.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/lib/db/client';
import { getMarketNews, type NewsResult } from '../src/lib/news';
import { rankNews } from '../src/lib/news/rank';
import { TOPICS } from '../src/lib/news/topics';
import { getBellwetherQuotes, type QuotesResult } from '../src/lib/quotes';
import { eventDetail } from '../src/lib/rationale';
import { FOMC_EVENT_TYPE, MACRO_RELEASE_TYPES } from '../src/lib/impact';
import type { MarketEvent } from '../src/lib/types';
import { todayET } from '../src/lib/time';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'artifact');
const OUT_FILE = join(OUT_DIR, 'market-calendar.html');

interface Row {
	id: string;
	kind: string;
	date: string;
	et_minutes: number | null;
	session: string;
	title: string;
	impact: string;
	symbol: string | null;
	forecast: string | null;
	previous: string | null;
	source: string;
}

async function loadEvents(): Promise<MarketEvent[]> {
	const res = await db().execute(`
		SELECT id, kind, date, et_minutes, session, title, impact, symbol,
		       forecast, previous, source
		FROM events
		ORDER BY date ASC,
		         CASE WHEN et_minutes IS NULL THEN 1 ELSE 0 END ASC,
		         et_minutes ASC
	`);
	return (res.rows as unknown as Row[]).map((r) => ({
		id: r.id,
		kind: r.kind as MarketEvent['kind'],
		date: r.date,
		etMinutes: r.et_minutes,
		session: r.session as MarketEvent['session'],
		title: r.title,
		impact: r.impact as MarketEvent['impact'],
		symbol: r.symbol,
		forecast: r.forecast,
		previous: r.previous,
		source: r.source as MarketEvent['source'],
	}));
}

/**
 * The impact rationales, keyed the way the runtime can look them up.
 *
 * Embedded per TYPE rather than per event: there are 9 macro types and one
 * earnings rule, against several hundred rows. Expanding it per row would add
 * a couple of hundred kilobytes of identical prose to a file people share.
 *
 * The text comes from eventDetail() rather than being retyped here, so the
 * artifact cannot drift from src/lib/impact.ts.
 */
function buildDetails(): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const type of [...MACRO_RELEASE_TYPES, FOMC_EVENT_TYPE]) {
		const probe: MarketEvent = {
			id: `macro:2026-01-01:${type.key}`,
			kind: 'macro',
			date: '2026-01-01',
			etMinutes: type.etMinutes,
			session: type.session,
			title: type.title,
			impact: type.impact,
			symbol: null,
			forecast: null,
			previous: null,
			source: type.key === FOMC_EVENT_TYPE.key ? 'federalreserve' : 'fred',
		};
		const d = eventDetail(probe);
		out[type.key] = {
			rationale: d.rationale,
			sourceUrl: d.sourceUrl,
			notes: d.notes,
		};
	}

	// One earnings entry covers every ticker: the rule is a market-cap table,
	// not a per-company judgement. The runtime fills in the NASDAQ link.
	const earningsProbe: MarketEvent = {
		id: 'earnings:2026-01-01:aapl',
		kind: 'earnings',
		date: '2026-01-01',
		etMinutes: 7 * 60,
		session: 'premarket',
		title: 'Probe',
		impact: 'High',
		symbol: 'AAPL',
		forecast: null,
		previous: null,
		source: 'nasdaq',
	};
	const timed = eventDetail(earningsProbe);
	const untimed = eventDetail({ ...earningsProbe, etMinutes: null });
	out.__earnings__ = {
		rationale: timed.rationale,
		notes: timed.notes,
		// The extra line for rows NASDAQ gave no time for, appended by the
		// runtime rather than duplicating the whole block.
		notesNoTime: untimed.notes.slice(timed.notes.length),
	};

	return out;
}

/**
 * Headlines, captured at export time.
 *
 * Never fatal. `npm run artifact` has to keep working with no network — the
 * calendar is the deliverable and the rail is the garnish, so a failed fetch
 * costs you the rail and nothing else.
 */
async function loadNews(events: MarketEvent[]): Promise<NewsResult> {
	try {
		return await getMarketNews({ events, limit: 40 });
	} catch (err) {
		console.warn(`  news:     skipped (${String(err).slice(0, 120)})`);
		return { items: [], failed: [], fetchedAt: new Date().toISOString(), symbolDates: {} };
	}
}

/**
 * Quotes, captured at export time.
 *
 * These go into the artifact as a FROZEN snapshot and are labelled as one.
 * That is the honest treatment: the clock and the countdown in this file stay
 * live because they are computed from the reader's own clock, but a price
 * cannot be recomputed from anything the file knows. Showing a stale number
 * with a live-looking beacon would be the one genuinely misleading thing this
 * export could do.
 */
async function loadQuotes(): Promise<QuotesResult> {
	try {
		return await getBellwetherQuotes();
	} catch (err) {
		console.warn(`  quotes:   skipped (${String(err).slice(0, 120)})`);
		return { quotes: [], marketStatus: null, failed: [], fetchedAt: '' };
	}
}

/** Safe to drop inside a <script> block. */
function embed(value: unknown): string {
	// U+2028 / U+2029 are valid JSON but illegal raw in a script body, and
	// "</script>" inside a string would close the tag early. Escape all four
	// by code point rather than matching the raw characters.
	return JSON.stringify(value).replace(
		/[<>\u2028\u2029]/g,
		(c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
	);
}

async function main(): Promise<void> {
	const events = await loadEvents();
	if (events.length === 0) {
		throw new Error(
			'No events in the database. Run `npm run refresh` before exporting.',
		);
	}

	const news = await loadNews(events);
	const quotes = await loadQuotes();
	const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');
	const runtime = readFileSync(join(ROOT, 'scripts/artifact-runtime.js'), 'utf8');
	const today = todayET();

	const dates = events.map((e) => e.date).sort();
	const coverage = { first: dates[0], last: dates[dates.length - 1] };

	const html = `<title>Market Calendar</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Public+Sans:wght@400;500;600;700&display=swap">
<style>
/*
 * Verbatim copy of src/app/globals.css — the live app's stylesheet.
 * The two font variables are supplied by next/font in the app; here they are
 * bound to the same families loaded from Google Fonts above.
 */
:root {
	--font-sans: 'Public Sans';
	--font-mono: 'JetBrains Mono';
}

${css}

/* Artifact-only additions: the snapshot banner, the frozen board, and the
   empty state. */

/*
 * A frozen quote board must not look live. The beacon holds still and the
 * status reads grey rather than green, whatever session the market happened
 * to be in when this file was written.
 */
.bw.phase-frozen .bw-phase {
	color: var(--dim);
}

.bw.phase-frozen .bw-beacon {
	animation: none;
	opacity: 0.5;
}

.snapshot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 14px;
	border: 1px solid var(--border);
	border-left: 3px solid var(--macro);
	background: var(--panel);
	border-radius: 5px;
	padding: 9px 14px;
	margin-bottom: 14px;
	font-size: 12px;
	color: var(--muted);
}

.snapshot b {
	color: var(--text);
	font-weight: 600;
}

.snapshot .kbd {
	border: 1px solid var(--border);
	border-radius: 3px;
	padding: 1px 5px;
	color: var(--dim);
	font-size: 11px;
}

.seg > button {
	padding: 5px 11px;
	font-size: 12px;
	font-family: inherit;
	color: var(--muted);
	border: none;
	border-right: 1px solid var(--border);
	background: var(--panel-alt);
	cursor: pointer;
	transition: background 0.12s ease, color 0.12s ease;
}

.seg > button:last-child {
	border-right: none;
}

.seg > button:hover {
	background: var(--panel-hover);
	color: var(--text);
}

.seg > button[aria-pressed='true'] {
	background: var(--panel-hover);
	color: var(--text);
	box-shadow: inset 0 -2px 0 var(--medium);
}

.seg > button:focus-visible,
.seg > a:focus-visible {
	outline: 2px solid var(--medium);
	outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
	* {
		animation: none !important;
		transition: none !important;
	}
}
</style>

<div id="board"></div>
<div class="ticker" id="ticker"></div>

<div class="wrap">
	<header class="site">
		<div>
			<h1><span class="brandmark mono">MC</span>Market Calendar</h1>
			<p class="tag">Macro releases, index-constituent earnings, and the economic news around them &mdash; one timeline, ranked by impact.</p>
		</div>
		<div class="legend">
			<span><i style="background:var(--macro)"></i>Macro</span>
			<span><i style="background:var(--earnings)"></i>Earnings</span>
			<span><i style="background:var(--high)"></i>High</span>
			<span><i style="background:var(--medium)"></i>Medium</span>
			<span><i style="background:var(--low)"></i>Low</span>
		</div>
	</header>

	<div class="snapshot">
		<span><b>Snapshot.</b> Data captured ${today}. This shared copy does not refresh &mdash; the live site does. <b>Prices are frozen</b> at export time.</span>
		<span>Covering <span class="mono">${coverage.first}</span> to <span class="mono">${coverage.last}</span>, <span class="mono">${events.length}</span> events.</span>
		<span class="kbd">&larr; &rarr; weeks</span>
		<span class="kbd">t today</span>
		<span class="kbd">w / d view</span>
		<span class="kbd">/ filter</span>
		<span>Click any row for its impact rationale and source.</span>
	</div>

	<div class="toolbar">
		<div class="group">
			<div class="seg">
				<button type="button" id="prev" aria-label="Previous">&larr;</button>
				<button type="button" id="today">Today</button>
				<button type="button" id="next" aria-label="Next">&rarr;</button>
			</div>
			<span class="range mono" id="range"></span>
		</div>
		<div class="group">
			<div class="seg">
				<button type="button" id="view-week" aria-pressed="true">Week</button>
				<button type="button" id="view-day" aria-pressed="false">Day</button>
			</div>
			<div class="seg">
				<button type="button" id="tz-et" aria-pressed="true">ET</button>
				<button type="button" id="tz-local" aria-pressed="false">Local</button>
			</div>
		</div>
	</div>

	<div class="desk" id="desk"></div>

	<main id="days"></main>

	<footer class="site">
		<div><strong>Sources.</strong> Macro release dates from FRED (St.&nbsp;Louis Fed) <span class="mono">release/dates</span>. FOMC decision dates from federalreserve.gov. Earnings and quotes from NASDAQ's public API, filtered to S&amp;P&nbsp;500 and Nasdaq-100 constituents. Headlines from six public RSS feeds &mdash; the Federal Reserve, BEA and Census directly, plus CNBC and MarketWatch. Index tiles quote the tracking ETF, because NASDAQ's quote API carries only its own indices and only end-of-day.</div>
		<div><strong>Read the stamps.</strong> Every row and every headline carries the source it came from, and agency releases are stamped apart from wire coverage. Open any row for the impact rationale verbatim. Times are scheduled, not guaranteed. Macro rows have no forecast because FRED publishes no consensus estimates.</div>
		<div><strong>Known gaps.</strong> ISM PMI is absent: ISM had all its series removed from FRED in 2016, so there is no free path to it. Historical earnings rows show no time because NASDAQ only supplies it for upcoming dates.</div>
		<div>Not investment advice. Informational use only.</div>
	</footer>
</div>

<script>
window.__EVENTS__ = ${embed(events)};
window.__NEWS__ = ${embed({ items: news.items, symbolDates: news.symbolDates })};
window.__HOT__ = ${embed(
		(() => {
			// The lead is scored HERE, not in the runtime: the ranking rule lives
			// in src/lib/news/rank.ts and porting it to the artifact would be a
			// second copy free to disagree with the site. A snapshot only needs
			// the answer.
			const top = rankNews(news.items, Date.parse(news.fetchedAt) || 0)[0];
			return top ? { id: top.item.id, reasons: top.reasons } : null;
		})(),
	)};
window.__QUOTES__ = ${embed(quotes)};
window.__DETAILS__ = ${embed(buildDetails())};
window.__TOPICS__ = ${embed(TOPICS.map((t) => ({ key: t.key, label: t.label, eventKeys: t.eventKeys })))};
window.__TODAY__ = ${embed(today)};
</script>
<script>
${runtime}
</script>
`;

	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(OUT_FILE, html, 'utf8');

	console.log(`wrote ${OUT_FILE}`);
	console.log(`  events:   ${events.length}`);
	console.log(`  coverage: ${coverage.first} -> ${coverage.last}`);
	console.log(`  news:     ${news.items.length} headlines`);
	console.log(`  quotes:   ${quotes.quotes.length} instruments (${quotes.marketStatus ?? 'unknown'})`);
	console.log(`  size:     ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
