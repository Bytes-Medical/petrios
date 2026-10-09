---
name: gates
description: Run the full Petrios verification gate suite (typecheck, lint, unit tests, production build, e2e) in the safe order, with the Next 16 dev-server footguns handled. Use before committing substantive changes or when asked to "run the gates" / verify the build.
---

# Verification gates

Run every gate below, in this order. Report each result honestly — a red gate
stops the line, it is never "probably fine".

## Order matters (Next 16 footguns)

Next 16 allows **one dev server per project** (dev-lock), and `npm run build`
**corrupts `.next` for a running or subsequent dev server**. The safe sequence:

1. `s/typecheck` — `tsc --noEmit` (the build also type-checks, but this fails faster)
2. `s/lint` — ESLint flat config; also enforces the `lib/db/` data-access boundary
3. `s/test` — Vitest unit tests (`lib/**/*.test.ts`)
4. **Stop any running dev server** (check for a listener on 3000)
5. `s/build` — production build
6. `rm -rf .next` — the build output breaks the e2e dev server; always clear it
7. Kill stale e2e listeners: `lsof -ti:3100 | xargs kill -9` (ignore errors)
8. `npm run test:e2e` — Playwright starts its own dev server on **port 3100**
9. `rm -rf .next` again before restarting a dev server for the user

## e2e invariants

- `playwright.config.ts` must keep `localhost` (NOT `127.0.0.1`) as the
  baseURL/webServer origin — Next 16 silently blocks cross-origin dev scripts,
  which kills hydration and makes every interaction test fail mysteriously.
- If e2e fails with hydration-looking symptoms, suspect a stale `.next` or a
  second dev server before suspecting the test.

## Also check

- `npm audit` — the project has shipped with 0 vulnerabilities; keep it there.
- Commit messages: `s/commits --from origin/main --to HEAD` must pass
  (Conventional Commits, commitlint).

## Rules

- Never push. Committing and pushing happen only when the user explicitly asks,
  and never bundled together uninvited.
- If a gate fails, include the actual failing output in your report — do not
  summarize it away.
