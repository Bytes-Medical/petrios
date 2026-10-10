# Petrios documentation

| Document | Covers |
|---|---|
| [api.md](./api.md) | Public REST API v1: `pt_` tokens, scopes, endpoints, webhooks |
| [self-hosting.md](./self-hosting.md) | Running Petrios on your own infrastructure (Docker, SMTP, migrations, health) |
| [petrios-meet.md](./petrios-meet.md) | Petrios Meet video: JaaS setup on Render and Workers, external-teacher prerequisite, verification, rollout impact |
| [security/rls-lockdown.md](./security/rls-lockdown.md) | Applying migration 062 (Data API / RLS lockdown) by hand: drift pre-checks, post-checks, rollback, follow-up and exposure summary |
| [cloudflare-workers.md](./cloudflare-workers.md) | Cloudflare Workers staging build, preview, deploy, cron safety and limits |
| [compliance/dpia-template.md](./compliance/dpia-template.md) | Data Protection Impact Assessment template for deployments |
| [compliance/dtac.md](./compliance/dtac.md) | DTAC (Digital Technology Assessment Criteria) mapping |

Architecture and subsystem behaviour live in [`spec/`](../spec/README.md);
this folder is operator- and integrator-facing documentation.

**License:** this documentation is licensed under
[CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) —
share and adapt with attribution ("Petrios"), share-alike. The Petrios
source code is separately licensed under AGPL-3.0-or-later (see the
repository `LICENSE` and `NOTICE`).
