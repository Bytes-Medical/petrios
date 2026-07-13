# Roadmap

Where Petrios is heading, and why some obvious things aren't built
yet. Issues and PRs against these items are very welcome — please read
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and the relevant [`spec/`](./spec/README.md)
first.

## Interoperability

- **LTI 1.3 tool provider** — surface Petrios sessions and attendance
  inside institutional LMSs (Blackboard, Moodle, Canvas). Deliberately not
  stubbed: a conformant implementation needs OIDC login initiation, deep
  linking, and Assignment & Grade Services, tested against a real platform.
- **Webhook retries** — deliveries are one-attempt today (the
  `webhook_deliveries` table already records failures; a retry cron with
  backoff is the natural next step).
- **API rate limiting** — per-token limits; today, front the API with your
  reverse proxy's limits.

## Portability & federation

- **Teaching record import/merge** — `/verify/record` verifies portable
  records today; importing a verified record into a local passport (with
  provenance shown) completes the rotation story.
- **Key rotation** for instance signing keys (publish previous keys in
  `.well-known`).

## Self-hosting

- **Plain-Postgres + pluggable auth** — the `lib/db/` layer was built to
  make the database swap tractable; replacing Supabase Auth (GoTrue) is the
  larger half. Design sketch welcome before code.
- **Single-container evaluation image** (bundled Postgres) for
  try-it-in-five-minutes demos.

## Product

- **Department retention rollup** — median per-session retention across
  sessions with >=5 recall responses, on the department schedule page
  (per-session analytics shipped; same suppression rules).
- **Rota-group equity lens** — today's equity view aggregates by grade;
  tagging members with rota groups makes exclusion patterns directly
  actionable (and feeds slot-time suggestions).
- **Authenticated e2e tests** — the Playwright suite covers the public
  surface; authed flows need disposable Supabase test infrastructure in CI.
- **WCAG 2.2 accessibility audit** of the design system.
- **Screenshots / demo video** for the README, backed by the seeded demo.
