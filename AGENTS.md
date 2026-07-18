# Agent & contributor guide

Tool-neutral entry point for anyone (human or coding agent) working on
Petrios. The canonical guidance lives in two places:

1. **[`CLAUDE.md`](./CLAUDE.md)** — the compact architecture summary:
   backend pattern, role hierarchy, key subsystems, environment variables.
   Despite the filename it is tool-agnostic; read it first.
2. **[`spec/`](./spec/README.md)** — detailed per-subsystem specifications
   and the **non-negotiable invariants** (data-access boundary, append-only
   attendance evidence, AI approval gate, and more). Read the relevant spec
   before changing a subsystem, and **update it in the same change** if
   behaviour shifts — a spec that contradicts the code is a bug.

## Commands

```bash
s/dev        # dev server at localhost:3000     (or: npm run dev)
s/test       # unit tests, Vitest               (or: npm test)
s/lint       # ESLint                           (or: npm run lint)
s/typecheck  # tsc --noEmit
s/build      # production build — stop the dev server first
s/commits --from origin/main --to HEAD  # Conventional Commit messages
npm run test:e2e   # Playwright smoke (public surface)
```

All wrappers run from the repository root and forward arguments.

## Ground rules for changes

- Table access goes through `lib/db/` — enforced by ESLint
  (`no-restricted-imports`); the auth-plane allow-list lives in
  `eslint.config.mjs` and additions to it are a review decision.
- New tables enable RLS; migrations are `NNN_snake_case.sql`, additive,
  never edited after applying.
- No AI-initiated outbound email outside the approval gate
  (`spec/06-petrios-ops.md`).
- Commits are signed off (DCO — see [`CONTRIBUTING.md`](./CONTRIBUTING.md)).
- Verification before any PR: `s/lint && s/typecheck && s/test && s/build`.
