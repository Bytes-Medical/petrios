# DPIA template — Petrios deployment

Pre-filled Data Protection Impact Assessment skeleton for a trust deploying
Petrios. Complete the *[fill in]* sections with your deployment's
specifics and route through your IG process.

## 1. Processing overview

| | |
|---|---|
| Controller | *[fill in: your trust]* |
| Processor(s) | Self-hosted: none beyond the trust. Hosted variants: Supabase (database/auth), email provider (Resend or trust SMTP), optional AI provider *[fill in]* |
| System | Petrios (open source, AGPL-3.0), version *[fill in]* |
| Purpose | Administration of postgraduate teaching: scheduling, attendance evidence, anonymous session feedback, certificates, teaching-portfolio evidence |

## 2. Data categories & subjects

- **Subjects**: trainees, faculty, external teachers (email only), organisers.
- **Personal data**: name, work email, training grade, teaching attendance
  records (with evidence source), teaching activity (sessions taught,
  feedback themes), reflections (written by the subject, visible only to
  them), certificates.
- **Not processed**: patient data. Feedback is anonymous by design;
  welfare-signal detection routes concerning free text to humans and
  excludes it from AI processing outputs.

## 3. Lawful basis

*[fill in — typically Art. 6(1)(e) public task for NHS education
administration, or 6(1)(f) legitimate interests; reflections and portfolio
features operate at the subject's initiative.]*

## 4. Flows & storage

- All state in Postgres (Supabase) — location *[fill in: your server/region]*.
- Email: *[fill in: trust SMTP relay (recommended for self-host) or Resend]*.
- AI (optional): prompts contain session titles/descriptions and anonymised
  feedback text; prompt text is never stored (audit keeps hashes + token
  counts). Endpoint: *[fill in: disabled / in-network model via
  OPENAI_BASE_URL / OpenAI]*.
- Video (optional): Jitsi rooms on *[fill in: meet.jit.si or trust-hosted]*.

## 5. Retention & rights

*[fill in your schedule.]* Technical notes: every table is keyed by user/org
ids making SAR export and erasure tractable; certificates and portfolio
packs are subject-requested artifacts; attendance evidence is append-only
by design (document your justification for audit retention).

## 6. Risks & mitigations (starter list)

| Risk | Mitigation in product | Residual action |
|---|---|---|
| Unauthorized data access | RLS everywhere; deny-all + audited service layer for sensitive tables; org-scoped hashed API tokens | *[access review process]* |
| Free-text feedback contains sensitive disclosures | Deterministic welfare-signal detection → human review, excluded from AI outputs and newsletters | *[local escalation route]* |
| AI processing of personal data | Names stripped pre-prompt; prompt text never stored; kill switch; in-network endpoint option | *[choose endpoint; record decision]* |
| Attendance misuse (performance managing trainees) | Product records teaching-quality metrics only; equity lens aggregates by cohort, never ranks individuals for assessment | *[usage policy]* |
| Email misdelivery | Per-recipient sends, capability links are single-purpose HMAC tokens | *[DLP as applicable]* |
