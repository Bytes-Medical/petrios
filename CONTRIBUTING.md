# Contributing to Petrios

Thanks for your interest in contributing. A few things to read before
you send a pull request.

## License of your contribution

This project is licensed under **AGPL-3.0-or-later**. By contributing
code, documentation, or other materials to this repository, you agree
that your contributions will be licensed under the same AGPL-3.0-or-later
terms as the rest of the project, as described in [`LICENSE`](./LICENSE).

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
```

See [`CLAUDE.md`](./CLAUDE.md) for architectural context: server actions
in `app/actions/`, the data-access layer in `lib/db/`, role hierarchy,
and evidence-based attendance.

## Style

- TypeScript, Next.js 14 App Router
- Tailwind CSS for styling
- Server Actions for mutations; the data-access layer at `lib/db/`
  owns all Supabase queries — do not import `@supabase/*` from action
  files or components. See [`lib/db/README.md`](./lib/db/README.md) for
  the pattern.
- Follow the existing monospace / minimal design language.

## Reporting security issues

Please do **not** open a public GitHub issue for security
vulnerabilities. Contact the copyright holder directly.
