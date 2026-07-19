# DPIA template — Petrios deployment

This pre-filled Data Protection Impact Assessment skeleton must be completed for
the actual Petrios deployment and approved through the controller's information
governance process. It is not a risk acceptance, legal opinion, or proof of
compliance. Replace every *[fill in]* marker and verify statements against the
deployed commit and configuration.

## 1. Governance and screening

| Field | Assessment |
|---|---|
| Controller / joint controllers | *[legal names, addresses, DPO contacts, responsibilities]* |
| Processor(s) | *[contracting host/operator; attach Article 28 terms]* |
| System owner / SIRO / IG lead | *[fill in]* |
| Version and environment | *[commit/release, production URL, assessment date]* |
| Intended use | Administration of postgraduate/clinical teaching; *[confirm local scope]* |
| People | Trainees, faculty, organisers, external teachers, administrators, support/security contacts |
| DPIA trigger | Workforce education records; systematic attendance evidence; free text that may contain sensitive disclosures; public capability records; optional AI/external providers; *[local screening]* |
| Prior consultation | *[DPO, users, unions/workforce, clinical safety, security, procurement]* |
| Approval / review | *[decision, residual risk owner, review date and change triggers]* |

## 2. Processing purposes and lawful basis

Map each purpose separately. Do not use one generic basis for the whole system.

| Purpose | Necessary data | Proposed UK GDPR basis | Necessity / alternative |
|---|---|---|---|
| Account and access control | Name, work email, auth/session and membership | *[Art. 6 basis]* | *[why required]* |
| Teaching administration | Session, teacher, invite, slot and contact data | *[basis]* | *[fill in]* |
| Attendance evidence/result | Identity, session, source, timestamps, derived status | *[basis]* | *[proportionality and employment implications]* |
| Identified feedback | Name, email, rating, answers, comments | *[basis]* | *[why identity is collected; consider anonymous/pseudonymous alternative]* |
| Certificates / portfolio / Recall | Achievement, recognition route, attendance, reflections, Audio Recap playback, attempts, answers, completion | *[basis]* | *[fill in]* |
| Operational communications | Recipient and email content/status | *[basis; PECR assessment]* | *[fill in]* |
| Security and audit | Actor, action, object, IP/provider logs | *[basis]* | *[fill in]* |
| Optional AI assistance | Purpose-limited prompts/output, speech script, and run/provider metadata | *[basis; Art. 22 assessment]* | *[provider/disabled alternative]* |

If special-category data is intentionally processed or foreseeably retained in
free text, identify an Article 9 condition and Schedule 1/DPA 2018 requirements.
“Users were told not to enter it” reduces but does not eliminate the risk.

## 3. Data inventory and accuracy

- **Identity/account:** name, email, grade, profile, auth identifiers and status.
- **Authority:** organisation/department memberships, roles, invitations and
  teaching assignments.
- **Teaching:** sessions, teachers, locations/video, contacts, slots and claims.
- **Attendance:** append-oriented evidence, source and timestamp, derived status,
  locks, exports, and public/signed record material.
- **Feedback:** public/accountless submission but identified storage of name,
  email, ratings, answers and comments; moderator audit; teacher release may
  include submitter name.
- **Learning record:** certificates and recognition basis, Recall playback,
  attempts/answers/completion and reflections
  coverage, portfolio snapshots and teaching dossier data.
- **Communications:** recipients, bodies, attachments, delivery status,
  unsubscribe capabilities and provider logs.
- **Technical/security:** cookies, request/network metadata, audit events,
  API/webhook credentials, run hashes, errors and infrastructure logs.

Document source, mandatory/optional fields, accuracy owner, correction workflow,
and downstream copies for every category. Confirm that patient data is outside
the intended use and publish a free-text prohibition and escalation route.

## 4. Data flows, recipients, and locations

Attach a diagram covering browser → app host → Supabase; app → email; browser →
Jitsi; app → optional LLM/document/research provider; app → optional speech
provider; cron/webhook/API flows; logs, monitoring and backups.

| Recipient/service | Role and purpose | Data | Region/retention | Contract and transfer safeguard |
|---|---|---|---|---|
| Supabase project | Database/auth | *[fill in]* | *[region/backups]* | *[DPA; transfer]* |
| Application host/CDN | Web runtime/network | *[fill in]* | *[fill in]* | *[fill in]* |
| SMTP or Resend | Email | *[fill in]* | *[fill in]* | *[fill in]* |
| Jitsi host | Optional meetings | *[fill in]* | *[fill in]* | *[fill in]* |
| LLM/research provider | Optional inference, private learning-document processing, and hosted research | *[session/assistant/feedback inputs; uploaded document contents; derived search queries; output/citations]* | *[provider logging/retention/region]* | *[DPA; transfer; search/tool subprocessors]* |
| Speech provider | Optional Audio Recap MP3 synthesis | Current moderator-reviewed recap script and speech request metadata; no uploaded document files or research queries in this step | *[provider logging/history, retention, region, deletion]* | *[DPA; transfer; ElevenLabs/OpenAI account posture]* |
| Support/security/monitoring | *[fill in]* | *[fill in]* | *[fill in]* | *[fill in]* |

Reconcile the table with `/subprocessors`, provider dashboards and executed
contracts. Self-hosting only keeps data inside an estate if every configured
dependency, log, backup, email, meeting and AI flow does so.

## 5. Transparency and choice

- Configure `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTROLLER_ADDRESS`,
  `PRIVACY_CONTACT_EMAIL`, `DATA_HOSTING_REGION`, and
  `DATA_TRANSFER_SAFEGUARDS`; verify `/privacy` in production.
- Provide the notice at first collection, including public feedback and invite
  flows, not solely in the footer.
- Petrios ships only essential authentication storage and no advertising or
  behavioural tracking. Reassess PECR/consent before adding analytics or embeds.
- Petrios acknowledges Global Privacy Control and has no sale/share for
  cross-context behavioural advertising. Do not claim that posture if an
  operator adds incompatible technology.
- Explain which AI paths run, what content is sent, provider retention, human
  review, and how to use a non-AI route where appropriate.
- Assess LLM/document/research and speech as separate external flows. Verify the
  deployed speech provider, model/voice provenance, repeat-request credit impact,
  logging/history setting, and whether any claimed zero-retention mode is
  contractually and technically available on the selected account.

## 6. Retention, deletion, and rights

Petrios has no universal automatic retention schedule. Define a period, trigger,
technical deletion method, backup expiry, legal/audit exception, and owner for
each category. Address attendance evidence, feedback, notifications/email,
audit/security logs, certificates and public verification, portfolio snapshots,
AI/provider logs, and deprovisioned accounts.

Map access, correction, deletion, restriction, objection, portability, complaint,
and identity-verification workflows. Test cross-table search/export and record
how public verification data, derived attendance, signed exports, email already
delivered, and processor copies are handled. Avoid claiming that relational IDs
make erasure “straightforward” without a tested workflow.

## 7. Necessity and proportionality questions

- Why is identified rather than anonymous feedback required? Can identity be
  separated, shortened, pseudonymised, or omitted from teacher release?
- Are attendance sources/windows/priority accurate, understandable, appealable,
  and prohibited from unintended performance-management use?
- Are public codes and capability links sufficiently random, scoped, expiring or
  revocable for the data exposed?
- Are free-text fields necessary, bounded, warned, moderated and retained for the
  minimum period?
- Is each AI purpose necessary? Can the same outcome use deterministic logic or
  an in-network model? Are small cohorts and identifying free text protected?
- Do roles expose only what the user's teaching/administration duty requires?

## 8. Risk register starter

Score likelihood/impact before and after controls using the controller's method.

| Risk | Existing product control | Required operator treatment |
|---|---|---|
| Cross-organisation access | Server role/org checks, RLS, DAL boundary | Access review, tenant tests, monitoring, incident route |
| Misleading anonymity claim | Specs/public notice state identified collection | User wording review; redesign identity/teacher release if required |
| Sensitive free-text disclosure | Ops welfare detection, quarantine, human review | Warning, moderation/escalation, retention, Article 9 assessment |
| AI/provider disclosure or retention | Purpose gate, name stripping on Ops path, hashes in Ops audit, kill switches | Choose provider/region/retention; DPA/transfer; disable if unjustified |
| Attendance used unfairly | Evidence/source visibility, deterministic derivation, locks | Usage policy, correction/appeal, workforce consultation |
| Capability URL forwarded/leaked | Signed/random scoped links where implemented | Expiry/revocation review, log redaction, user guidance |
| Email wrong recipient | Per-recipient sends and scoped links | Directory quality, DLP, bounce handling, incident process |
| Data retained indefinitely | Deletion possible at storage layer | Approved schedule, automation, verification and exception log |
| Vendor/region drift | Public runtime-aware register and env disclosures | Contract/dashboard reconciliation and subprocessor change process |
| Service outage/data loss | Stateless app, database backup capability | Tested backups, restore, RPO/RTO, communications plan |

## 9. Sign-off

Record unresolved high risks, consultation outcomes, controller/processor actions,
decision, accountable approver, expiry/review date, and triggers including new
data fields, AI purposes, providers, public routes, integrations, user groups,
legal requirements, or material incidents.
