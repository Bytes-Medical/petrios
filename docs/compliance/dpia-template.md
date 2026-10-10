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
| Rota availability (optional, off by default) | Per-session "rostered unavailable" flags for matched trainees, keyed identity links, counts-only audit; per-day status grid received transiently | *[Art. 6(1)(e) expected; Art. 8A compatibility; see section 9]* | *[why rota-based excusal is needed; the manual alternative is trainee self-report]* |

If special-category data is intentionally processed or foreseeably retained in
free text, identify an Article 9 condition and Schedule 1/DPA 2018 requirements.
“Users were told not to enter it” reduces but does not eliminate the risk.

## 3. Data inventory and accuracy

- **Identity/account:** name, email, grade, profile, auth identifiers and status.
- **Authority:** organisation/department memberships, roles, invitations and
  teaching assignments.
- **Teaching:** sessions, teachers, locations/video, slots and claims; the
  organisation address book (external contacts auto-captured from invitations,
  RSVPs and slot claims) and contact groups.
- **Ops assistant (opt-in, `OPS_ASSISTANT_ENABLED=true`):** chat threads stored
  verbatim and organisation-wide memory notes.
- **Attendance:** append-oriented evidence, source and timestamp, derived status,
  locks, exports, and public/signed record material.
- **Feedback:** public/accountless submission but identified storage of name,
  email, ratings, answers and comments; moderator audit. Teacher release
  contains aggregate scores, question-level analytics and an optional
  moderator-reviewed, name-stripped AI summary, and never respondent names,
  email addresses or raw comments (spec 05). With a small cohort the teacher
  may still infer who responded.
- **Learning record:** certificates and recognition basis, Recall playback,
  attempts/answers/completion and reflections
  coverage, portfolio snapshots and teaching dossier data.
- **Rota availability (only where enabled; section 9):** per-session
  "rostered unavailable" flags for matched trainees, decision/contest state,
  keyed identity links, and counts-only upload audit. No leave category.
- **Communications:** recipients, bodies, attachments, delivery status,
  unsubscribe capabilities and provider logs.
- **Technical/security:** cookies, request/network metadata, audit events,
  API/webhook credentials, run hashes, errors and infrastructure logs.

Document source, mandatory/optional fields, accuracy owner, correction workflow,
and downstream copies for every category. Confirm that patient data is outside
the intended use and publish a free-text prohibition and escalation route.

## 4. Data flows, recipients, and locations

Attach a diagram covering browser → app host → Supabase; app → email; browser →
meeting provider (8x8 JaaS / self-hosted Jitsi embedded with app-minted room
passes, or meet.jit.si opened directly); app → optional LLM/document/research provider; app → optional speech
provider; cron/webhook/API flows; logs, monitoring and backups.

| Recipient/service | Role and purpose | Data | Region/retention | Contract and transfer safeguard |
|---|---|---|---|---|
| Supabase project | Database/auth | *[fill in]* | *[region/backups]* | *[DPA; transfer]* |
| Application host/CDN | Web runtime/network. List every host that serves this database, including a Cloudflare Workers staging Worker (docs/cloudflare-workers.md), which the Render-served `/subprocessors` page cannot name | *[requests, IP, cookies, app data in transit; runtime logs, which can include recipient email addresses (Workers Logs on Cloudflare)]* | *[fill in]* | *[fill in]* |
| SMTP or Resend | Email | *[fill in]* | *[fill in]* | *[fill in]* |
| Meeting provider (8x8 JaaS / self-hosted Jitsi / meet.jit.si) | Optional Petrios Meet video rooms; the active mode is named on `/subprocessors`. JaaS makes 8x8 a subprocessor | *[JaaS/self-hosted: room pass with display name (never email), per-session pseudonymous id and moderator flag; room name from the session id; session title; audio/video/chat/screen share. meet.jit.si: nothing from Petrios; participants go to Jitsi directly and the room starter signs in to Jitsi]* | *[fill in]* | *[fill in]* |
| LLM/research provider | Optional inference, private learning-document processing, and hosted research. Default Anthropic (Files API: documents uploaded per generation, one-hour expiry, deleted afterwards, daily orphan sweep; web search called directly, allow-listed); optional OpenAI-compatible endpoint | *[session metadata incl. invited teachers' names (invitee email where no name); assistant messages and tool results; purpose-limited feedback; uploaded document contents (OpenAI-compatible: original DOCX/PPTX files incl. comments and author properties; Anthropic: extracted body text and PPTX speaker notes); derived search queries; output/citations]* | *[provider logging/retention/region; whether Files API/web search fall under any zero-retention arrangement; OpenAI document requests send `store: false`, abuse-monitoring retention still applies]* | *[DPA; US transfer safeguard; search/tool subprocessors]* |
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
- Record which LLM provider is configured (`LLM_PROVIDER`/keys) and that an in-network OpenAI-compatible endpoint is pinned with `LLM_PROVIDER=openai`.
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

## 9. Rota availability integration (complete only if enabled)

Petrios's rota availability feature (spec 14, operator guide `docs/rota.md`) is
off by default. Complete this section before an organisation enables it; the
organisation admin must enter this DPIA's reference in Settings before Petrios
allows the switch. It covers Phase 1 only (browser upload and attendance
suggestions). Scheduling availability counts and an automated push API are not
built; assess them separately if they ship.

### 9.1 Screening and roles

| Field | Assessment |
|---|---|
| Why a DPIA is mandatory | Data matching across systems (ICO list); employees as data subjects; a form of worker monitoring. Record the DPO's advice (Art. 35(2)) and staff-side views (Art. 35(9)) |
| Controller of the rota data | Normally the employing trust. *[confirm; in a lead-employer arrangement name the employer]* |
| Petrios's role | Normally processor under Art. 28 terms. If the Petrios organisation is run by a different body from the employing trust (for example a deanery, NHSE WT&E region, or a programme hosted elsewhere), the rota summary is a controller-to-controller disclosure and needs a data-sharing agreement. *[record the determination]* |
| Information Asset Owner (rostering system) | *[name; approval of the extract and its minimisation; licence check]* |
| DME and Guardian of Safe Working Hours | *[sign-off of the code map and post-night rule]* |
| Staff side (LNC / resident doctors' forum) | *[consultation date, views, and response]* |
| Assurance requested | *[Petrios DSPT status, DTAC, Caldicott Guardian briefing (Principles 3, 4, 8)]* |

### 9.2 Lawful basis and compatibility

- **Article 6:** *[Art. 6(1)(e) public task is expected for NHS trusts:
  education is part of the 2016 TCS work schedule; Art. 6(1)(b) is the
  alternative]*. Not consent, because of the employment power imbalance.
- **Purpose compatibility (UK GDPR Article 8A,** inserted by the Data (Use and
  Access) Act 2025 s.71, in force from 5 February 2026**):** the rota was
  collected for rostering and pay; reuse is to excuse missed teaching fairly.
  *[record the assessment: link between purposes, context and expectations,
  nature of the data, consequences, safeguards]*.
- **Article 9: expected not to be engaged; confirm.** Every kind of leave,
  including sickness, collapses to the single letter `L` inside the trust
  boundary (the coordinator's browser) before anything is sent, no category is
  stored, and no logic branches on one. ICO guidance treats a bare absence
  record as not likely to be special category. It would become special category
  if anyone intended to infer health from it or treated people differently
  because of such an inference: hence the bans on analytics, category splits,
  and performance use. *[confirm; re-check the ICO workers' health guidance,
  which is under review after the DUAA]*.

### 9.3 Data flow

```text
Rostering system (trust)
  -> export CSV on a trust device
  -> coordinator's browser: parse, map codes to A/D/N/X/L, infer post-night rest,
     drop names/codes/other columns, match identities
  -> Petrios Server Action (HTTPS): per matched person a day-status string,
     staff number and/or work email in clear (transient)
  -> keyed HMAC of identifiers; session overlap computed; grid discarded
  -> stored: per-session "rostered unavailable" flags, keyed links, counts-only audit
  -> moderator confirms individually -> attendance evidence (EXCUSED)
```

No new subprocessors: the request travels through the existing application host
(Render, or Cloudflare Workers including edge processing and Workers Logs) and
Supabase. The existing `DATA_HOSTING_REGION` and `DATA_TRANSFER_SAFEGUARDS`
disclosures must cover it. Request bodies are not logged.

### 9.4 Field list

| Stored by Petrios | Received in the request, used, then discarded | Never received |
|---|---|---|
| Per session, only for unavailable trainees: "rostered unavailable" flag, as-of time, planned/as-worked, decision state, who decided and when, contest time | The per-person day-status grid (one letter per day, −2 to +8 weeks; runs of `L` and patterns of `X` are visible for the length of the request) | The raw export; shift codes; leave reason or type; sickness or occupational-health data |
| Keyed-HMAC identity links (staff number or email → account), moderator-confirmed | Staff numbers and work emails in clear, only to compute the HMAC. At the match check, the staff number or email of **every row** of the export (up to 500, including consultants, nurses and other staff in the file) is checked once against the department's trainees and discarded; coordinators should export only the department's doctors in training | Names (moderator name matching happens in the browser); ward, grade, pay codes, hours, LTFT status or reason, notes |
| Upload and match-preview audit: counts, keyed digest (HMAC with the server secret, never a plain hash), upload id, date range, uploader | | Number of unavailable people per upload |
| Session activity events for a confirmed, dismissed or contested suggestion (batch id and planned/as-worked; never a reason) | | |
| The moderator's `MODERATOR_CONFIRMATION` evidence row (`EXCUSED`, `reason_code: ROTA_UNAVAILABLE`, reason "Rostered unavailable (rota)", upload batch id): a lasting part of the attendance record | | |

Status letters:

| Letter | Status |
|---|---|
| `A` | Available (a normal day shift counts as available) |
| `D` | On duty elsewhere (on-call or a clashing long day, per code) |
| `N` | Nights or post-night rest (46 hours after any night run by default) |
| `X` | Not working |
| `L` | Leave of any kind |

### 9.5 Human involvement (Art. 22 and ICO ADM guidance)

- Each suggestion is confirmed or dismissed individually; there is no bulk
  accept and nothing is pre-selected.
- Confirmation is possible only after the session has ended, and is re-checked
  on the server (no check-in or other moderator decision exists).
- The suggestion is logged separately from the decision, with the rota's as-of
  time shown.
- The trainee sees their own flag at any time and can contest it (after a
  confirmation step); a contested flag cannot be confirmed from the
  suggestion. Dismissals and contests leave a lasting activity record.
- The finalize confirmation warns how many suggestions are still undecided.
- Finalization never depends on rota data; without a decision a trainee is
  simply recorded absent, as before.

*[record why this is meaningful human involvement and not a solely automated
decision]*

### 9.6 Access

Per-person rota status is visible to the session's department moderators and
the organisation's admins of the same organisation (from session start until
finalization, and again after a reopen), and to the trainee for their own
sessions. Teachers, faculty, the rota coordinator, API clients, reports, and
platform super admins see none of it. *[confirm against role assignments]*

### 9.7 Retention

| Data | Kept until |
|---|---|
| Session flag | *[N, default 30; 1–90]* days after the later of attendance finalization and the Audio Recap catch-up closing; never later than session end + 90 days; earlier on session move/cancel, leaving the department, or disable |
| Identity link | Until the person is no longer a trainee in an enrolled department, the moderator revokes it, the organisation disables rota, or the account is deleted |
| Uploader grant | Until revoked or the coordinator leaves the organisation |
| Upload and preview audit (counts and a keyed digest) | 12 months |
| Confirm / dismiss / contest activity events | The organisation's session activity retention *[fill in]* |
| Confirmed excusal evidence | The organisation's attendance retention *[fill in]* |
| Raw file, per-day grid, codes, names, reasons | Never stored |

Deletion is automatic (an hourly purge, also on every upload, running even if
the feature is switched off). The organisation admin can also disable (deleting
every flag and identity link), remove departments and remove uploaders while
the feature is switched off. *[backup expiry for deleted rows]*

### 9.8 Accuracy (Art. 5(1)(d))

As-worked uploads for past days, the as-of time on every suggestion, the
"rota changed since you confirmed" marker, the trainee contest, and human
confirmation. Upload discipline is the main accuracy risk: *[weekly upload
owner and cover]*.

### 9.9 Residual risks

| Risk | Product control | Operator treatment |
|---|---|---|
| Inference over time: repeated confirmed excusals may suggest extended absence (for example parental or long-term sick leave) to a moderator | No category, no analytics, no history or trend view, no performance use; excused attendance already reveals this today | *[accept / mitigate; moderator guidance]* |
| Perceived surveillance by trainees or the BMA (R10) | Off by default, one phrase only, published wording, contest route, catch-up kept, invitation copy signposts exception reporting | *[staff-side consultation outcome; communications plan]* |
| Membership oracle: the coordinator's "matched / not matched" booleans reveal whether an identifier belongs to a trainee | One preview per upload, at most 500 people, 10 per day (enforced atomically); the upload can carry only rows from that preview; the coordinator's upload result carries counts only; a trainee of the department cannot be the coordinator; audited by counts | *[accept; coordinator role limited to the named person]* |
| Wrong-person link | Moderator confirmation per person, links resolve only to current trainees of the department, revocable, no self-linking, anti-hijack rule across departments | *[moderator training]* |
| Stale or wrong rota | As-worked uploads, as-of time, contest, rota-changed marker, finalize independent of rota | *[upload discipline]* |
| Rubber-stamping | No bulk accept, per-row server checks, separate suggestion and decision records | *[moderator guidance]* |
| Small-cohort inference from scheduling counts (R9) | **Not applicable to Phase 1**: no counts are produced. If Phase 2 ships: 5-person floor, banding, rounding to 5, no names | *[reassess before Phase 2]* |
| Staging or preflight writing to the production database | Kill switch pinned to `"false"` there; deploy validators refuse other values | *[deployment review]* |

### 9.10 Staff privacy-notice wording

Adapt for the trust's staff notice (Petrios `/privacy` carries a version):

> Your department's teaching platform, Petrios, receives a limited summary of
> your rota from *[Trust]*'s e-rostering system. The summary gives one status per
> day: available, on duty elsewhere, on nights or post-night rest, not working,
> or on leave. Petrios uses it at the moment it arrives and does not keep it.
> Petrios keeps only a note against each teaching session for which you were
> rostered unavailable. It never receives the reason for leave or any sickness
> information. The note is used only to suggest to the session moderator that
> your absence be excused (the moderator decides, and you can say the rota was
> wrong). Session notes are deleted within *[30]* days of attendance being
> finalised and never later than 90 days after the session. If your moderator
> confirms an excusal, your attendance record for that session shows "excused –
> rostered unavailable" and is kept with your other attendance records. It is
> never used to assess your performance. Before an upload, the staff number or
> email of every row in the export is checked once against the department's
> trainees and is not stored. This does not replace exception reporting;
> please still exception-report missed teaching to your educational supervisor
> (*[DME]* can also help). Lawful basis: *[public task]*. Contact: *[DPO]*.

## 10. Sign-off

Record unresolved high risks, consultation outcomes, controller/processor actions,
decision, accountable approver, expiry/review date, and triggers including new
data fields, AI purposes, providers, public routes, integrations, user groups,
legal requirements, or material incidents.
