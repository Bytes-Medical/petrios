# Rota fixtures — SYNTHETIC ONLY

Every file here is invented test data. **Never commit a real rota export**,
not even a redacted one, and never upload a real export anywhere except the
Petrios rota page of the organisation it belongs to.

- `synthetic-wide.csv` — grid layout (one column per date), anchored on
  2026-10-12, covering 2026-09-28 … 2026-12-07 (−14 … +56 days).
- `synthetic-long.csv` — list layout (one row per duty, with times), same
  people, first 28 days.
- `synthetic-profile.json` — the upload profile for the grid file.
- `generate-synthetic.mjs` — regenerates both files for another anchor date
  (`node lib/rota/__fixtures__/generate-synthetic.mjs 2026-11-02 wide`). The
  local-lab end-to-end run uses it with today's date so "yesterday" and
  "+3 days" line up with the seeded sessions.

People (all fictional, `example.test` addresses): T1 nights before the
anchor's previous day (post-night rest covers it) and the night before
anchor+3; T2 and T5 normal day shifts; T3 annual leave on anchor−1; T4 staff
number only, with a multi-code `LD/OC` cell on anchor−5; "Dr Ghost" has no
Petrios account. Weekends are `OFF` except anchor−1 and anchor+3, the lab's
session days. Expected flags (anchor = today): T1 and T3 on anchor−1 12:30,
T1 on anchor+3 12:30; T2, T4 and T5 cleared.
