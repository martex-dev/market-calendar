# Fixtures

Captured real responses, kept so the shape of each external API is documented
in the repo rather than only in a comment.

- `nasdaq-earnings-2026-08-25.json` — a full `GET /api/calendar/earnings?date=2026-08-25`
  response (45 rows). Useful for checking field names and NASDAQ's string
  formatting (`marketCap` as `"$122,927,344,726"`, `time` as
  `"time-pre-market"`) without making a live request.

These are reference samples only — nothing in `src/` reads them yet. Wiring
them into offline tests is a reasonable next step.
