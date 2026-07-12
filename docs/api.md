# Petrios API (v1)

Org-scoped REST API for integrating rota systems, data warehouses, or your
own frontends. Full schema: [`/openapi.json`](../public/openapi.json).

## Authentication

Create a token in **Settings → API Tokens** (org admins only). Tokens are
shown once, scoped, and revocable; only a hash is stored server-side.

```bash
curl -H "Authorization: Bearer pt_..." \
  "https://your-instance.example/api/v1/sessions?status=PUBLISHED&from=2026-09-01T00:00:00Z"
```

Scopes: `read:sessions`, `write:sessions`, `read:attendance`,
`read:certificates`, `read:departments`, `read:slots`.

Errors are always `{ "error": string, "code": string }` with conventional
status codes (401 unknown/revoked token, 403 missing scope, 404, 400).

> **Note:** there is no built-in rate limiting yet (see ROADMAP.md) — put the
> API behind your reverse proxy's limits for untrusted consumers.

## Endpoints

| Method | Path | Scope |
|---|---|---|
| GET | `/api/v1/sessions` (`from`, `to`, `department_id`, `status`) | read:sessions |
| POST | `/api/v1/sessions` (creates a DRAFT) | write:sessions |
| GET | `/api/v1/sessions/{id}` | read:sessions |
| POST | `/api/v1/sessions/{id}/publish` | write:sessions |
| GET | `/api/v1/sessions/{id}/attendance` | read:attendance |
| GET | `/api/v1/departments` | read:departments |
| GET | `/api/v1/slots` (open + future) | read:slots |
| GET | `/api/v1/certificates/{code}` | read:certificates |

## Webhooks

Register endpoints in **Settings → Webhooks**. Events:
`session.published`, `attendance.computed`, `certificate.issued`,
`slot.claimed`.

Each delivery is a POST with:

- `X-Petrios-Event`: the event name
- `X-Petrios-Signature`: `sha256=<hex HMAC of the raw body, keyed by your endpoint secret>`
- Body: `{ "event": string, "created_at": iso8601, "data": { … } }`

Verify (Node example):

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(secret, rawBody, signatureHeader) {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  return (
    signatureHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected))
  )
}
```

Delivery semantics: **one attempt, at-least-zero** — check recent deliveries
in Settings; automatic retries are on the roadmap. Webhook URLs must be
public http(s) addresses (private ranges are blocked in production).
