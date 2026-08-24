# Market Calendar

One day-by-day calendar of everything that could move US stocks: macro
releases and index-constituent earnings, merged into a single ranked list.

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

## Deploying to Vercel

1. Create a Turso database and set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`.
   The local SQLite fallback cannot work on Vercel — serverless filesystems
   are ephemeral.
2. Set `FRED_API_KEY` and `CRON_SECRET` in project settings.
3. `vercel.json` already declares the cron job (`/api/cron/refresh`, 06:00
   daily). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically
   once that variable exists.

Hobby-plan constraints that shaped this: cron fires **at most once per day**,
timing is only guaranteed within the hour, and functions cap at **60 seconds**.
A full refresh measured ~2s for 87 requests, so there is plenty of headroom —
`WINDOW_FORWARD_DAYS` in `src/lib/refresh.ts` is the lever if that changes.

## Notes

- `AGENTS.md` is generated and re-added by `next dev`; deleting it just
  recreates it.
- Conventions: tabs, single quotes.
