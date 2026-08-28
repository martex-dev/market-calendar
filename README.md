# Market Calendar

**Live:** https://market-calendar-three.vercel.app

One day-by-day calendar of everything that could move US stocks: macro
releases and index-constituent earnings, merged into a single ranked list —
under a live quote board of the names that lead the market, and two news
windows tagged back to the rows they are about.

See `CLAUDE.md` for scope and the reasoning behind it. This file is setup.

## Quick start

```bash
npm install
npm run refresh   # populates the database from FRED + NASDAQ
npm run dev
```

Without a FRED key the refresh still works — you get earnings and FOMC dates,
and the macro leg reports a clear error instead of failing the whole job.

## Environment

Copy `.env.example` to `.env.local` and fill in what you need.

| Variable | Required | Notes |
| --- | --- | --- |
| `FRED_API_KEY` | for macro data | Free, no card: https://fredaccount.stlouisfed.org/apikeys |
| `TURSO_DATABASE_URL` | in production only | Blank locally → falls back to a SQLite file |
| `TURSO_AUTH_TOKEN` | with the above | |
| `CRON_SECRET` | in production only | Any random string; protects the cron route |

## How data gets in

Three independent sources, merged into one `events` table:

| Source | What | Module |
| --- | --- | --- |
| FRED `release/dates` | 8 curated macro releases | `src/lib/fred/` |
| federalreserve.gov | FOMC decision dates (hand-maintained) | `src/lib/fomc.ts` |
| NASDAQ calendar API | Earnings, filtered to S&P 500 + Nasdaq-100 | `src/lib/earnings/` |

### The Bellwethers board

The top strip is the equity answer to a forex terminal's "Majors" row. Eleven
instruments, hand-picked with a stated reason each in
`src/lib/quotes/bellwethers.ts`: four index trackers and the seven largest
index weights.

Quotes come from `api.nasdaq.com/api/quote` — the same host the earnings
calendar already uses, through the same client. That was not a free choice:
Yahoo's quote endpoint now 401s without a crumb and Stooq is end-of-day, while
NASDAQ returns a real-time last sale, both sessions, and the exchange's own
market status. It also means the market-status pill is authoritative rather
than derived from the clock, so it is right on holidays.

**Index tiles are tracking ETFs, and are labelled as such.** NASDAQ's quote
API only carries its own indices — `SPX`, `INDU`, `RUT` and `VIX` all return
"Symbol not exists", and `COMP`/`NDX` come back end-of-day. SPY, QQQ, DIA and
IWM quote live on the same endpoint. A row that said "S&P 500" and moved once
a day would be worse than one that says SPY and is current.

Like news, quotes are **not** in the database: a 60-second request-path cache,
refreshed by the client. Prices are the one thing here that changes faster
than the nightly cron.

### News

News is the exception too — it does **not** go in the database. Six public RSS
feeds (`src/lib/news/feeds.ts`) are read on the request path and cached by
Next's Data Cache for 10 minutes, because the once-daily Hobby cron that suits
a release calendar would serve yesterday's headlines all day. Three are the
issuing agencies themselves (Federal Reserve, BEA, Census) and three are wires
(CNBC Economy, CNBC Finance, MarketWatch); the UI stamps those two tiers apart.

The two windows above the calendar are **Hot Story** and **Latest Stories**.
The lead is chosen by a fixed weighted sum in `src/lib/news/rank.ts` — topic
weight, whether the issuing agency published it, how many outlets are covering
the subject, and a 12-hour recency half-life — and the panel prints the
reasons it won. Nothing is learned or tuned; it is a small table you can read.
That ranking rule is *not* the same thing as an impact tag: `CLAUDE.md` fixes
event impact to a per-type lookup because scheduled events have types to look
up, whereas every headline is unique and ordering them needs a rule that reads
the item.

Every headline is tagged back to the calendar by `src/lib/news/topics.ts`:
keyword match onto the macro release families, plus a company-name match
against the earnings rows currently loaded. Wire items matching neither are
dropped — that gate is what keeps personal-finance columns out of a market
calendar. Both passes are fixed string tables with no scoring, for the same
reason impact tags are.

The FRED and NASDAQ clients share nothing but `src/lib/types.ts`, per
`CLAUDE.md`. Impact tags live in `src/lib/impact.ts` with a cited rationale
per event type, so classifications can be reviewed without reading fetch code.

Constituent lists come from two different places, and the reason is in
`src/lib/earnings/constituents.ts`: the S&P 500 list is scraped from
Wikipedia, but the Nasdaq-100 Wikipedia article no longer carries a
components table, so that half comes from NASDAQ's own endpoint.

## Known gaps

These are deliberate, not oversights:

- **No ISM Manufacturing/Services PMI.** `CLAUDE.md` lists them, but ISM had
  the St. Louis Fed remove all 22 ISM series from FRED in June 2016, so there
  is no free FRED path to them. Dropped from v1.
- **No forecast values for macro rows.** FRED publishes no consensus
  estimates of any kind. Earnings rows do get a consensus EPS from NASDAQ.
- **No time on historical earnings rows.** NASDAQ only populates its `time`
  field for upcoming dates; past dates come back `time-not-supplied` for every
  row. Forward-looking rows — the ones that matter — do have times.
- **The FOMC date table is hand-maintained** and currently runs to Dec 2027.
  The refresh job warns when it is within 90 days of running out.
- **Two mega-caps can have no jump target.** A tile navigates to the week that
  company reports, but the database only holds a -30/+90 day window, so a name
  reporting outside it (GOOGL and TSLA, from late August) filters the calendar
  without navigating. Widening `WINDOW_FORWARD_DAYS` is the lever.
- **News feed choice is editorial.** `src/lib/news/feeds.ts` states why each
  of the six is in the list. MarketWatch's MarketPulse feed looks like the
  better fit than Top Stories by name but is stale — checked 2026-08-28, its
  newest item was from July 2025.

## Deploying to Vercel

1. Create a Turso database and set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`.
   The local SQLite fallback cannot work on Vercel — serverless filesystems
   are ephemeral.
2. Set `FRED_API_KEY` and `CRON_SECRET` in project settings.
3. Turn off **Settings -> Deployment Protection -> Vercel Authentication**.
   New Vercel projects enable it by default, which puts the whole site
   (including the cron route) behind a Vercel login wall — the deploy looks
   successful but every request 302s to `vercel.com/sso-api`. Set it to
   "Only Preview Deployments", or Disabled on Hobby.
4. `vercel.json` already declares the cron job (`/api/cron/refresh`, 06:00
   daily). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically
   once that variable exists.

Hobby-plan constraints that shaped this: cron fires **at most once per day**,
timing is only guaranteed within the hour, and functions cap at **60 seconds**.
A full refresh measured ~2s for 87 requests, so there is plenty of headroom —
`WINDOW_FORWARD_DAYS` in `src/lib/refresh.ts` is the lever if that changes.

## Using it

- Rows expand. Click any one for its impact rationale verbatim from
  `src/lib/impact.ts`, what the source can and cannot tell you, a link to the
  issuing agency, and any headlines about that release.
- All three surfaces share one filter state (`FilterContext`). A topic chip
  filters the news windows *and* the calendar; a ticker chip — on a headline
  or on a mega-cap quote tile — jumps to the week that company reports and
  filters the calendar to it. Index tiles are deliberately not clickable:
  there is no SPY row on this calendar, so filtering to it could only empty
  the page.
- Keys: `←` `→` step the range, `t` today, `w` / `d` switch view, `/` filter,
  `Esc` clear.
- The top rail scrolls continuously and pauses on hover or via its button.
  Under `prefers-reduced-motion` it stops entirely and becomes a scrollable
  list instead.

## Notes

- `AGENTS.md` is generated and re-added by `next dev`; deleting it just
  recreates it.
- `npm run artifact` emits a single shareable HTML file that inlines
  `globals.css` and reproduces the same DOM the React components render, so
  restyling the app restyles the artifact. It carries a frozen snapshot of the
  events, the headlines and the quotes. The clock and countdown still run,
  because those are computed from the viewer's own clock — prices cannot be,
  so the board is stamped "frozen" and its beacon does not pulse.
- Conventions: tabs, single quotes.
