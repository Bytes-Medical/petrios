# Contributing to Petrios

Thanks for your interest in contributing. A few things to read before
you send a pull request.

## License of your contribution

Petrios is dual-licensed by material type (see [`NOTICE`](./NOTICE)):

- **Code** is licensed under **AGPL-3.0-or-later**, as described in
  [`LICENSE`](./LICENSE).
- **Documentation, specifications, and website copy** (`docs/`, `spec/`,
  README content, and the public site text) are licensed under
  **CC-BY-SA 4.0**.

By contributing to this repository, you agree that your contributions
will be licensed under the same terms as the material you are
contributing to — AGPL-3.0-or-later for code, CC-BY-SA 4.0 for
documentation and specifications.

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO) instead of a contributor license agreement (CLA). The DCO is a
lightweight way for you to certify that you wrote the contribution, or
otherwise have the right to submit it under the project's license.

The full text of the DCO (v1.1) is reproduced below:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

### How to sign off

Add a `Signed-off-by` line to every commit message. The easiest way is
to pass `-s` (or `--signoff`) to `git commit`:

```bash
git commit -s -m "feat: add something useful"
```

That will automatically append a line like:

```
Signed-off-by: Your Name <you@example.com>
```

The name and email must match a real identity you can be reached at.
Pull requests containing commits without DCO sign-off will be asked
to re-sign before merge.

## Conventional Commits

Every authored commit and every pull-request title must follow
[Conventional Commits](https://www.conventionalcommits.org/):

```text
type(optional-scope): short imperative description
```

The repository uses `@commitlint/config-conventional`. Accepted types are:

- `build` — build system or external dependency changes;
- `chore` — maintenance that does not change production behaviour;
- `ci` — continuous-integration configuration;
- `docs` — documentation-only changes;
- `feat` — a new user-visible capability;
- `fix` — a user-visible defect correction;
- `perf` — a performance improvement;
- `refactor` — code restructuring without a behaviour change;
- `revert` — reverting an earlier commit;
- `style` — formatting or other non-functional source changes; and
- `test` — tests or test infrastructure.

Scopes are optional and should be short and lower-case. Use the imperative mood,
keep the subject concise, and do not end it with a full stop. Examples:

```text
feat(attendance): add locked-session audit history
fix(auth): use the configured callback origin
docs(compliance): document subprocessor review
ci: enforce conventional commits
```

For a breaking change, put `!` before the colon and add a `BREAKING CHANGE:`
footer. The DCO sign-off remains a separate footer and is required even when the
header is conventional:

```text
feat(api)!: replace the attendance response envelope

BREAKING CHANGE: API consumers must read attendance from the data property.
Signed-off-by: Your Name <you@example.com>
```

Validate the latest commit locally:

```bash
s/commits --from HEAD~1 --to HEAD
```

Validate a branch against `main`:

```bash
s/commits --from origin/main --to HEAD
```

GitHub CI checks every commit introduced by a pull request, the pull-request
title (because squash merges use it as the commit subject), and every commit in
a direct push to `main`. Git-generated merge/revert/version messages retain
commitlint's standard exemptions.

## Why the DCO and not a CLA?

The DCO is sufficient to establish provenance of contributions, and
together with the AGPL-3.0-or-later license it keeps the project's
licensing story simple. The copyright holder (Akanimoh Osutuk) retains
the right to offer the software under separate commercial licenses for
users who cannot comply with AGPL obligations (see [`NOTICE`](./NOTICE))
— contributions under AGPL + DCO do not interfere with that.

If you'd like to contribute a substantial feature and are concerned
about the dual-licensing implications, open an issue to discuss before
writing code.

## Development setup

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # also serves as type-check
npm run lint
s/commits --from origin/main --to HEAD
```

See [`CLAUDE.md`](./CLAUDE.md) for architectural context: server actions
in `app/actions/`, the data-access layer in `lib/db/`, role hierarchy,
and evidence-based attendance.

## Style

- TypeScript, Next.js 16 App Router
- Tailwind CSS for styling
- Server Actions for mutations; the data-access layer at `lib/db/`
  owns all Supabase queries — do not import `@supabase/*` from action
  files or components. See [`lib/db/README.md`](./lib/db/README.md) for
  the pattern.
- Follow the existing monospace / minimal design language.

## Reporting security issues

Please do **not** open a public GitHub issue for security
vulnerabilities. Contact the copyright holder directly.
