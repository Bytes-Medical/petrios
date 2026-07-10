# Security Policy

## Automated scanning

Every pull request is gated by the Security workflow
(`.github/workflows/security.yml`): CodeQL (uploaded to the Security tab),
Semgrep (Next.js/React/OWASP rulesets), TruffleHog secret scanning,
`npm audit` on production dependencies (high+ fails everywhere, including
main), and a Supabase RLS guard that blocks migrations creating tables
without Row Level Security. A weekly scheduled run catches newly published
queries and advisories; Dependabot keeps dependencies and SHA-pinned
actions updated.

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Report them privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab → "Report a vulnerability"). You should
receive an acknowledgement within a week.

## Scope notes for reviewers

- All database access is behind Supabase Row Level Security; several tables
  (`notifications`, `external_contacts`, `contact_groups`, `slot_*`, all
  `ops_*`) are deliberately deny-all and only reachable through the
  service-role data-access layer in `lib/db/` — authorization for those paths
  lives in the server actions (`app/actions/`) and CRON_SECRET-guarded routes.
- The Bytes Ops AI layer must never send outbound email without an approved
  `ops_pending_actions` row (`lib/ops/executors.ts` is the only send path)
  and never passes untrusted feedback text as instructions. Reports of any
  bypass of these invariants are especially welcome.
- Secrets live only in environment variables (`.env.example` documents them);
  none are committed.
