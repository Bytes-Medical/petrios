# DTAC evidence workbook — Petrios

This is a working evidence index for organisations assessing a Petrios
deployment against the NHS England Digital Technology Assessment Criteria
(DTAC). It is not a completed DTAC submission, certification, clinical-safety
case, penetration test, DPIA, or legal opinion. The deploying organisation must
verify the current DTAC version and complete every **operator evidence** item for
its architecture, contracts, policies, users, and intended use.

## Deployment record

| Item | Operator evidence |
|---|---|
| Legal controller / service owner | *[name, address, DPO/privacy contact]* |
| Petrios version / commit | *[immutable release or commit]* |
| Intended use and user groups | *[approved local statement]* |
| Application/database/backup regions | *[regions and providers]* |
| Support and incident contacts | *[routes and hours]* |
| Assessment owner and review date | *[owner, approvals, next review]* |

## A. Clinical safety

### Product evidence

- Petrios is designed for teaching administration: sessions, teachers,
  attendance evidence, feedback, certificates, portfolios, Recall, reporting,
  and optional operations assistance.
- It is not designed to store patient records, provide diagnosis or treatment
  recommendations, calculate clinical risk, or make direct-care decisions.
- AI purposes are allow-listed and exclude individual trainee evaluation.
  Welfare, safety, conduct, bullying, and safeguarding signals in feedback are
  routed for human review and excluded from stored Ops synthesis output.
- Attendance and educational records could still affect people if used outside
  their intended context. “Administrative” does not mean risk-free.

### Operator evidence

- *[DCB0129 supplier/manufacturer scope decision and clinical safety officer]*
- *[DCB0160 deploying-organisation scope decision, hazard log, and sign-off]*
- *[approved intended-use statement and prohibited-use policy]*
- *[process for welfare/conduct alerts, false results, downtime, and escalation]*
- *[change-control trigger for features that could influence clinical work]*

## B. Data protection

### Product evidence

- The canonical privacy boundary is `spec/13-privacy-security-and-compliance.md`;
  feedback-specific identity/release behaviour is in spec 05.
- Feedback entry is public and accountless but **identified**: name and email are
  stored. Authorised moderators can view raw identity, and current teacher
  feedback-release email includes submitter names. It must not be described as
  anonymous.
- The public `/privacy`, `/privacy/choices`, `/subprocessors`, and
  `/data-processing-agreement` pages expose deployment-specific gaps rather than
  substituting invented controller or location details.
- Petrios does not ship advertising, behavioural tracking, or non-essential
  analytics cookies. Supabase authentication uses essential first-party storage.
- Optional AI can be disabled or directed to an operator-controlled compatible
  endpoint. The Ops audit stores hashes and operational metadata, not raw prompt
  text; this does not override an AI provider's own logging or retention.
- Data subject export/erasure is not a one-click universal workflow. Controllers
  must map related data, public verification records, audit needs, provider logs,
  backups, lawful exemptions, and retention before operating the service.

### Operator evidence

- *[completed and approved DPIA from `dpia-template.md`]*
- *[Article 6 basis per purpose; Article 9 condition if sensitive free text is
  intentionally processed; employee/public-task power where applicable]*
- *[Article 13/14 notice with legal controller identity and monitored contact]*
- *[records of processing, data-flow map, and data minimisation review]*
- *[retention/deletion schedule with technical implementation and exception log]*
- *[executed Article 28 terms and reconciled subprocessor register]*
- *[hosting/backup locations, transfer assessment, adequacy/IDTA/Addendum]*
- *[rights-request, objection, complaint, breach, and regulator-notification process]*
- *[free-text policy prohibiting patient data and unnecessary sensitive data]*

## C. Technical security

### Product evidence

- Database access is scoped by Row Level Security or deny-all/service-role DAL
  paths; server actions enforce actor, role, and organisation boundaries. See
  specs 01, 02, and 11.
- Production responses set HSTS (one year), Content Security Policy,
  anti-framing, MIME-sniffing protection, referrer policy, and permissions
  policy. CSP permits required Supabase and configured Jitsi origins; inline
  script/style remains allowed for current Next.js rendering and is documented
  as a hardening limitation.
- API access uses hashed organisation-scoped tokens. Webhooks are HMAC-signed;
  known replay and SSRF limitations remain documented in spec 09.
- CI runs CodeQL, Semgrep, TruffleHog, production dependency audit, and a
  migration RLS guard. `SECURITY.md` defines private vulnerability reporting.
- Secrets are environment-provided. This is a source-code posture, not evidence
  that an operator's secret manager, deployment, logging, or staff access is safe.

### Operator evidence

- *[architecture and trust-boundary diagram for this deployment]*
- *[independent penetration test, remediation record, and retest]*
- *[asset inventory, SBOM/dependency process, patch SLA, EOL policy]*
- *[identity provider, MFA, joiner/mover/leaver, privileged-access review]*
- *[secret rotation, log redaction, SIEM/alerting, and audit-log retention]*
- *[backup encryption, restore test, RPO/RTO, and disaster-recovery exercise]*
- *[incident response, breach assessment, support escalation, and lessons learned]*
- *[network/egress controls, WAF/rate limiting, DNS/TLS ownership, DDoS posture]*

## D. Interoperability

### Product evidence

- Organisation-scoped REST API with OpenAPI 3.1 description.
- HMAC-signed webhook delivery for implemented event families.
- iCalendar feeds, CSV attendance/equity exports, and signed portable teaching
  records.
- Source available under AGPL-3.0; specifications under CC-BY-SA 4.0.
- Deployment requires a Supabase-compatible auth/schema environment rather than
  arbitrary PostgreSQL alone. Exact API, webhook, federation, and self-hosting
  limitations are in spec 09.

### Operator evidence

- *[integration inventory, data contracts, owners, test evidence, and failure handling]*
- *[NHS number/patient identifier decision—normally out of scope and prohibited]*
- *[export/exit plan, portability validation, and receiving-system responsibilities]*

## E. Usability and accessibility

### Product evidence

- Semantic page structure, keyboard-capable shared controls, focus states,
  reduced-motion posture, responsive layouts, and public Playwright smoke tests.
- Core small-text colour tokens meet WCAG 2.2 AA contrast against Petrios paper
  and card backgrounds. This token check is not a complete WCAG audit.
- No formal independent WCAG 2.2 AA conformance audit or accessibility statement
  is bundled. Product evidence must not be represented as certification.

### Operator evidence

- *[representative-user research and clinical/education workflow validation]*
- *[independent WCAG 2.2 AA audit across public and authenticated journeys]*
- *[keyboard, screen reader, zoom/reflow, contrast, error, timeout, PDF, and email testing]*
- *[published accessibility statement, support route, remediation owners and dates]*

## Release evidence checklist

Record the output and reviewer for:

```bash
s/lint
s/typecheck
s/test
s/build
npm run test:e2e
```

Also retain security-workflow results, dependency exceptions, migration review,
configuration review, an accessibility regression sample, and confirmation that
the public compliance pages contain the production controller/location details.
