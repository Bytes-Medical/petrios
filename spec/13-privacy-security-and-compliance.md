# 13 — Privacy, browser security, accessibility, and compliance evidence

## Scope and status

This specification defines the cross-cutting implementation contract for:

- public privacy, choice, subprocessor, and data-processing disclosures;
- controller/operator configuration that must remain truthful per deployment;
- personal-data categories and externally visible data flows;
- cookie, tracking, sale/share, and Global Privacy Control posture;
- browser response headers and Content Security Policy;
- design-token contrast requirements; and
- the boundary between product evidence and an operator's legal or regulatory
  assessment.

It describes implemented behaviour. It is not a statement that Petrios, a
particular host, or a deploying organisation is certified under UK GDPR, PECR,
CCPA/CPRA, DTAC, WCAG, or any other framework. Automated scanner scores are
diagnostic signals and must not be represented as legal certification.

The data-specific specifications remain controlling where they are more precise:
spec 03 for attendance evidence, spec 05 for feedback and certificates, spec 06
for Ops/AI, spec 08 for portfolio/Recall, spec 09 for providers/API/self-hosting,
spec 11 for identity, and spec 12 for reports/exports.

## Hard invariants

1. **Missing deployment facts stay visibly missing.** Code must not invent a
   controller identity, postal address, monitored privacy mailbox, hosting
   region, or international-transfer mechanism. Public pages render an explicit
   “not declared by this deployment” state until the operator configures one.
2. **Feedback is not described as anonymous.** Public/accountless describes an
   authentication boundary only. Current submissions store name and email;
   moderator audit exposes them. Teacher feedback release omits respondent
   identity/raw comments and requires moderator review before a privacy-processed
   narrative can enter the approved snapshot. AI guidance and detailed analytics
   are available from the first response; reports below five responses explicitly
   warn that the evidence is limited and that participation may be inferred.
   Those controls still do not make the source record anonymous.
3. **No tracking banner without tracking.** The base application ships no
   advertising, behavioural tracking, or non-essential analytics storage, so it
   does not manufacture a consent banner. The public Display preference cookie
   (`petrios-display`, see Cookies posture) is interface storage set only at the
   visitor's request, not tracking. An operator or feature that introduces
   non-essential device storage/tracking must block it until required choice,
   update public disclosures, and update this spec.
4. **No sale/share claim may drift.** The base application does not sell personal
   information or share it for cross-context behavioural advertising. Introducing
   an incompatible recipient or purpose requires a real opt-out mechanism and a
   same-change update to `/privacy/choices`; a cosmetic link is insufficient.
5. **Provider disclosure does not imply provider safety.** Listing a processor,
   location, DPA, or transfer mechanism is not a security or adequacy finding.
   Operators must reconcile runtime configuration with contracts, dashboards,
   logs, backups, support tools, and onward subprocessors.
6. **Security headers cover every application response.** New page/route families
   remain under the `proxy.ts` header baseline unless a reviewed exception is
   necessary and documented. API routes do not bypass the header baseline. The
   only exceptions are the static files listed under Browser security baseline.
7. **Core small-text colour tokens retain WCAG AA contrast.** `gray.500` and
   `clay.600` must remain at least 4.5:1 against both their actual normal-text
   surfaces, and every public HUD text pair must stay at 4.5:1 or better in both
   Day and Night (see Public HUD tokens). Token compliance is not a full
   accessibility-conformance claim.
8. **Compliance documents distinguish code from operator evidence.** Repository
   controls may be cited as product evidence, but penetration testing, DPIA
   approval, DPA execution, lawful-basis selection, retention operation,
   accessibility audit, clinical-safety scope, backup testing, and incident
   readiness remain deployment responsibilities unless separately evidenced.

## Controller, processor, and deployment boundary

Petrios is open-source software and can be independently hosted. Repository
maintainers do not automatically receive or control data in every installation.
The organisation deciding the purposes and means of a deployment will normally
be the controller. A commercial or internal hosting/service operator may be a
processor; infrastructure/email/AI providers may be subprocessors or separate
controllers depending on facts and contracts.

The public notice deliberately uses conditional language. It cannot turn a
factual relationship into a controller/processor relationship. The executing
parties must make and document that determination.

### Public configuration

`lib/compliance.ts` is server-only and reads the following public disclosure
values at request time. Compliance pages are `force-dynamic` so Docker/runtime
environment injection is not lost to build-time static generation.

| Variable | Required production fact | Missing behaviour |
|---|---|---|
| `PRIVACY_CONTROLLER_NAME` | Controller's legal name | Explicit missing-controller warning |
| `PRIVACY_CONTROLLER_ADDRESS` | Controller's service/registered postal address | Explicit missing-address warning |
| `PRIVACY_CONTACT_EMAIL` | Actively monitored privacy/DPO address | No fabricated `mailto`; user is directed to inviting organisation |
| `DATA_HOSTING_REGION` | Application, database, and backup regions or an accurate combined description | Explicit missing-region warning |
| `DATA_TRANSFER_SAFEGUARDS` | Reviewed applicable mechanism/assessment summary | Explicit missing-safeguard warning |

These values are intentionally server variables rather than `NEXT_PUBLIC_*`:
they are rendered publicly but need not be bundled into every browser script.
They must contain public facts only—never contract secrets, credentials, or
internal hostnames.

Provider status is derived without exposing secrets:

- Render/Vercel flags identify the application-host family; otherwise the page
  says operator-managed host.
- `SMTP_HOST` selects an operator SMTP description; otherwise a configured
  `RESEND_API_KEY` selects Resend; absence is declared.
- `OPENAI_API_KEY` determines whether LLM/document/research AI is enabled.
  `OPENAI_BASE_URL` changes the label to operator-configured compatible endpoint
  without printing a potentially internal URL.
- Speech status is independently derived from `TTS_PROVIDER` and the selected
  provider's required credentials. The page names OpenAI API, an
  operator-configured compatible speech endpoint, or ElevenLabs API without
  printing a credential, internal base URL, or request content. Partial or
  invalid speech configuration is labelled incomplete rather than enabled.
- `NEXT_PUBLIC_JITSI_DOMAIN` selects the meeting-service label, defaulting to
  `meet.jit.si`.

## Public compliance surface

All following pages are public in `proxy.ts`, appear in `app/sitemap.ts`, and are
linked from the shared footer:

| Route | Contract |
|---|---|
| `/privacy` | Data categories, purposes, lawful-basis responsibility, feedback/AI truth, cookies, recipients, hosting/transfers, retention limitation, rights, security, and change notice |
| `/privacy/choices` | Exact sale/share posture, operator-change caveat, request-scoped GPC detection, and controller request route |
| `/subprocessors` | Runtime-aware service-category register plus operator reconciliation and change-notice obligations |
| `/data-processing-agreement` | Article 28 contracting framework and processing schedule; explicitly not executed terms |

The four pages render through `components/CompliancePage.tsx` inside the public
`HudShell` (spec 07 "Public site design system"). The page header carries two
readouts: "Deployment address", the host of the configured `appUrl` (not the
request host; omitted when it cannot be parsed), and "Last updated", the
`COMPLIANCE_LAST_UPDATED` constant in that file. The date is hard-coded, so a
material notice change must move it in the same change. Each page passes an
explicit `SECTIONS` constant to an "On this page" list whose `section-…`
anchors come from `lib/compliance-sections.ts` and keep the pre-redesign format,
so existing deep links still resolve. On /subprocessors the contents list stays
above the body at every width (`contents="stacked"`), so the register gets the
article's full width rather than the 68ch prose measure. The table keeps a 760px
minimum and scrolls sideways inside a keyboard-focusable region named by its
section heading wherever the column is narrower (viewports under 876px); from
876px it is not cramped and does not scroll. Its configurable rows show status
chips with an explicit tone (never matched from the status text).
`MissingDisclosure` keeps the fixed “Not declared by this deployment: …” wording
and adds an aria-hidden ▲ mark (an inline SVG one character cell wide, because
the glyph is outside the self-hosted Plex Mono subset) and a dashed frame, so the
gap is not shown by colour alone. Off-site links in legal prose carry the
aria-hidden ↗ like every other off-site public link. `lib/compliance-pages.test.ts` guards the exact h1s, the
contents-to-section mapping, the missing-disclosure wording, the GPC strings, and
the cookie paragraph below.

Page availability is not evidence that the contents are complete. A production
release review must fetch all four pages from the deployed origin, verify the
absence of “not declared” for facts the controller must supply, reconcile service
labels with runtime configuration, and retain the reviewer/date.

The DPA framework is not accepted merely by using the software. An executed
agreement must name parties, term, instructions, processing schedule,
confidentiality, measures, subprocessors/change notice, transfers, rights/DPIA/
breach assistance, return/deletion, audit, notices, governing terms, liability,
and order of precedence.

## Personal-data map

The public privacy notice summarizes these active families:

| Family | Representative data | Principal flows / exposure |
|---|---|---|
| Identity/account | Name, email, grade, auth id, profile/status | Supabase Auth/database; server-rendered role UI; authentication email |
| Authority | Org/department memberships, roles, invitations, assignments | Authorisation ladder, RLS/service DAL, moderator/admin surfaces |
| Teaching | Sessions, teachers, contacts, slots, claims, meeting configuration, private session documents, Audio Recap and newsletter document/research/speech provenance | Member pages, browser-direct signed upload to private storage and streamed download, invite email, calendar/API/webhook/export paths; explicit moderator Audio Recap generation sends current session documents to the configured LLM provider and may cause provider-hosted public-search queries derived from them; explicit newsletter generation sends every available document for the selected department/week but does not use web search; later audio creation sends only the stored draft script to the separately selected speech provider |
| Attendance | Evidence source/timestamp, roster, derived status, lifecycle revision, corrections, transparent Audio Recap catch-up source | Moderator/teacher views, in-app notifications, certificates, reports, portable records, portfolio |
| Feedback | First/last name, email, rating, answers, comment, aggregate report snapshots, optional reviewed AI-assisted narrative | Public submission; moderator raw audit; privacy-safe teacher release; stats; optional AI draft and explicit review |
| Learning evidence | Certificates and recognition basis, registered user or external invitation/email identity, recipient/coordinator/issuer names, Recall playback progress/attempts/answers/completion, reflections, snapshots | Identity-bound catch-up page; personal dashboards; certificate PDF email attachments; PDFs; capability verification pages (certificate coordinator/issuer and catch-up attribution are visible to a code bearer) |
| Communications | Recipient, reviewed content, newsletter source-document metadata, attachment, send/status/claim/unsubscribe metadata | SMTP/Resend; delivery ledgers; in-app notifications; capability links |
| Security/technical | Essential cookie, IP/network/provider logs, HMAC-pseudonymized group-code attempt data, API/audit/run metadata | App/database/provider logs, security monitoring and incident review |

Petrios is not designed for patient data. That design intention does not
technically prevent a user entering patient or special-category information in
free text. Deployments need policy, training, warnings, moderation, escalation,
retention, and (where applicable) a lawful Article 9 condition rather than
claiming such data can never exist.

## Feedback privacy terminology

The following words have distinct meanings:

- **Public/accountless**: the submission page does not require a login.
- **Identified**: stored submitter identity can be associated with the content.
- **Identity-field omitted**: a processing path does not deliberately include
  stored first name, last name, or email.
- **Privacy processed**: a named path applies rules such as known-name removal,
  small-cohort handling, safety quarantine, aggregation, or field exclusion.
- **Anonymous**: the person is not identifiable by reasonably likely means.

Current feedback is identified. Ops synthesis is privacy processed, but comments
can contain self-identifying text and deterministic removal is not a guarantee of
anonymisation. The general on-demand summary now omits identity columns, strips
known name-like tokens, fences untrusted text, and refuses configured welfare/
safety signals, but it does not implement every heuristic/structured Ops control
in spec 06. Teacher email may include the exact privacy-processed narrative
approved by a moderator from the first response;
only a zero-response report suppresses analytics. It never includes raw comments
or stored identity fields, and reports below five responses warn about weak
evidence and inference risk. The raw source and moderator audit remain identified
as specified in spec 05.

Marketing, prompts, code comments, assistant knowledge, documentation, exports,
and UI labels must use these terms consistently. Prompt wording matters because
calling identified input “anonymous” can cause the model to underweight privacy
risk even when no identity field is explicitly included.

## Cookies, tracking, privacy choice, and GPC

### Implemented posture

The base application uses Supabase first-party session storage for login/session
continuity. It has no bundled marketing pixels, behavioural-advertising SDKs,
third-party analytics, or data-broker integration. Public pages set no consent
preference because there is no optional tracking purpose to choose.

The only other device storage is the public Display preference. The footer of
every public page (`HudShell`, spec 07) offers Day (the default), Night, and
Match device. Choosing Night or Match device writes one first-party cookie from
the browser:

| Attribute | Value |
|---|---|
| Name | `petrios-display` (`DISPLAY_COOKIE`, `lib/public-display.ts`) |
| Values | `night` or `auto`; anything else, or no cookie, is read as Day |
| Lifetime | `Max-Age=15552000` (180 days, “up to 6 months” in the notice) |
| Attributes | `Path=/; SameSite=Lax`, plus `Secure` when the page is served over HTTPS. Not `HttpOnly`, because the control writes it in the browser |
| Set | Only when the visitor explicitly chooses Night or Match device; never on page view and never by the server |
| Deleted | When the visitor chooses Day (the control writes an empty value with `Max-Age=0`) |
| Read | By `HudShell` on the server, to render the right display with no inline script; by `DisplayControl` in the browser, to correct a stale cached render or a back/forward-cache restore |

It holds only that setting, carries no identifier, and is never sent to another
origin. The control's caption says “Night and Match device are remembered with a
cookie.” at the point of choice, and `/privacy` “Cookies and tracking” discloses
it in this fixed paragraph (guarded by `lib/compliance-pages.test.ts` and
`e2e/public-pages.spec.ts`):

> If you choose Night or Match device in the Display control on the public site,
> a first-party cookie named petrios-display remembers that choice on this device
> for up to 6 months. It holds only that setting, is not used to identify you, and
> is never set unless you choose one of those options. Choosing Day deletes it.

**PECR rationale.** This is user-interface customisation storage, set only at the
visitor's explicit request to provide the presentation they asked for. That is the
reading under which preference storage is treated as strictly necessary for a
service the user has requested, so it is not placed behind a consent banner and
invariant 3 still holds. Its persistence beyond the session is disclosed at the
point of choice and in the notice. This is a product position, not legal advice:
an operator with a stricter reading (for example, that persistent preference
cookies need consent) should review it, and may shorten the lifetime or make the
choice session-only. That is a change to `lib/public-display.ts`, and the notice
paragraph, its tests, and this section must move with it.

`/privacy/choices` includes “Do Not Sell or Share My Personal Information” in
its description and states that no sale/share for cross-context behavioural
advertising occurs. It reads the `Sec-GPC` request header:

- exact `1` renders “detected”; and
- other/absent values render “not detected”.

The result is request-scoped and is not stored. No tracking or identity cookie is
created to remember it because the default posture already refuses the relevant
activity. This acknowledgment must not be used to imply CCPA applicability or
compliance for every operator.

### Change trigger

Adding analytics, session replay, advertising, social pixels, A/B tooling,
fingerprinting, non-essential embedded resources, or another storage/access
technology requires a data-flow and PECR/other-law assessment before code runs.
Where choice is required, default-deny must occur before the technology loads;
footer text or an after-the-fact banner is insufficient.

## AI and external-provider transparency

The provider adapter and per-purpose data boundaries remain in specs 06 and 09.
Public disclosure adds these rules:

- An absent `OPENAI_API_KEY` is truthfully shown as LLM/document/research AI
  disabled. Speech is reported separately because ElevenLabs can be enabled
  without an OpenAI key and OpenAI speech can share the LLM key.
- The default configured endpoint is labelled OpenAI API. A custom endpoint is
  labelled generically so an internal hostname is not disclosed.
- The privacy notice names representative inputs: session metadata, assistant
  messages, purpose-limited feedback, private uploaded learning documents sent
  on an explicit Audio Recap or department/week newsletter generation click,
  Audio-Recap-only provider-hosted search queries that may be derived from those
  documents, public search results/citations, and recap script/audio text.
- The speech-provider request is a distinct purpose-limited flow. It receives
  only the current stored draft script and speech request metadata—not uploaded
  documents, extracted text, hosted-search queries, public page bodies, research
  citations, or raw feedback. Every re-creation is a new provider request and can
  consume provider credits.
- New audio stores `tts_provider`, model, and voice beside the MP3 so a moderator
  can identify how the artifact was made. Provider credentials and endpoints are
  never stored in the recap row. Editing/regenerating the script clears this
  provenance with the stale audio.
- Audio Recap search is restricted in code to an explicit authoritative-domain
  list and supplements rather than replaces the private learning material. The
  application stores URL/title citations and a research flag, not public page
  bodies. These controls narrow the flow; they do not make a document-derived
  search query non-confidential or remove the need for provider due diligence.
- Moderator-visible citations are ordinary external links. Opening one contacts
  that public site from the moderator's or attendee's browser and can disclose
  normal request metadata such as IP address and browser details under that
  site's policy. Petrios links use `noopener noreferrer`.
- Ops prompt/run logging stores hashes and operational metadata rather than raw
  prompts. This describes Petrios storage only; it does not claim a provider
  retains nothing.
- For the default OpenAI API, the notice states the documented default: API data
  is not used for model training unless the customer opts in, while abuse-
  monitoring logs may retain inputs/outputs for up to 30 days. Provider settings,
  eligibility, exceptions, and policy changes must be reviewed at deployment.
- When ElevenLabs is selected, the notice names ElevenLabs and directs the
  operator to reconcile its account's logging/history setting, retention,
  region, contract, subprocessors, deletion, and transfer posture. The product
  does not claim zero retention: availability depends on provider plan/account
  configuration and must be verified by the operator.
- Attendee playback labels the narration as AI-generated, and moderator audio
  creation remains subject to the same explicit review/approval gate as other
  recap content.
- Custom endpoints require their own training, retention, region, subprocessor,
  security, deletion, and transfer disclosure.

An AI transparency paragraph is not a lawful basis or DPIA. Deployments must
decide whether each purpose is necessary and proportionate and whether an
in-network/disabled alternative is required.

## Retention and data-subject operations

### Current limitation

Petrios has no universal retention engine and no single tested “delete person”
workflow spanning every relational table, auth record, sent email, provider log,
backup, signed export, certificate, public verification record, and snapshot.
The notice therefore does not promise automatic deletion after a generic period
or claim rights operations are straightforward.

Controllers must define category-specific:

1. retention period and start trigger;
2. purpose/lawful justification;
3. deletion, anonymisation, restriction, or archival action;
4. backup/provider-copy expiry;
5. public-code/revocation treatment;
6. legal, safety, audit, dispute, or record-keeping exception;
7. owner and approval;
8. implementation and sampled verification; and
9. communication to the person.

Attendance evidence is append-only in application/RLS operation and corrections
are new reasoned rows. Parent deletion can still cascade according to schema, so
controllers must define whether retention ends in parent deletion, restriction,
or continued preservation. Public/signed records already exported cannot
necessarily be recalled. Email already delivered cannot be erased from a
recipient mailbox by Petrios. Newsletter issue content, source-document metadata,
and delivery rows have no automated expiry. Archived private session documents
remain stored until a separate deletion/retention operation removes the object;
deleting an object does not rewrite a newsletter provenance snapshot or an email
already sent.

## Browser security baseline

`proxy.ts` applies these headers through `lib/security-headers.ts` to every
response its matcher reaches, with origins taken from runtime configuration
(`lib/runtime-config.ts`):

| Header | Implemented value / purpose |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`, sent only when the configured app URL is HTTPS; one-year HTTPS enforcement after a browser receives it over HTTPS |
| `Content-Security-Policy` | Source allow-list and injection-impact reduction described below |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY`, redundant defence for older clients alongside `frame-ancestors 'none'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Disables unused sensors/payment/USB; autoplay, camera, microphone, display capture, and fullscreen limited to self and configured Jitsi origin |
| `X-Permitted-Cross-Domain-Policies` | `none` |

HSTS intentionally omits `preload`: inclusion in a browser preload list creates
an operational commitment for the parent domain and subdomains and must not be
requested by source code without domain-owner review. Headers over local HTTP are
ignored by conforming browsers; production TLS termination must preserve them.

Current limitation: the proxy matcher skips `_next/static`, `_next/image`,
`favicon.ico`, and `.svg`/`.png`/`.jpg`/`.jpeg`/`.gif`/`.webp` files, so those
never carry these headers on any host. On Cloudflare Workers every file under
`public/` is also served by the Workers assets layer without running the Worker,
so `public/fonts/*.ttf` and `/openapi.json` additionally lack the whole baseline
(including CSP and `X-Content-Type-Options`) there. HTML, route-handler, and API
responses carry the full baseline on both hosts.

### CSP construction

Origins are normalized with the URL parser before header construction. Invalid
values fall back to the safe expected provider origin rather than being copied
verbatim into a response header. Supabase and configured Jitsi receive only the
source capabilities their current flows need.

Production directives:

- `default-src 'self'`
- `base-uri 'self'`
- `object-src 'none'`
- `frame-ancestors 'none'`
- `form-action 'self'`
- `script-src 'self' 'unsafe-inline' <jitsi-origin>`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: blob: https:`
- `font-src 'self' data:`
- `media-src 'self' blob:`
- `worker-src 'self' blob:`
- `frame-src 'self' <jitsi-origin>`
- `connect-src 'self' <supabase-http/ws> <jitsi-http/ws>`
- `upgrade-insecure-requests` (only when the configured app URL is HTTPS)

The Supabase origin in `connect-src` also carries browser-direct
session-document uploads to one-shot signed Storage URLs (spec 04); removing it
breaks uploads.

Development additionally permits `unsafe-eval` for framework tooling and local
HTTP/WebSocket connections. Production must never inherit those development
allowances.

### CSP limitations and change rules

Current Next.js server rendering and application styling require inline script
and inline style allowances. This CSP therefore materially restricts origins,
objects, framing, forms, and connections but is not a strict nonce/hash CSP.
Moving to per-request nonces is a future hardening item and must preserve React
streaming, proxy auth cookies, error pages, Jitsi loading, and caching semantics.

`img-src https:` is broad because user/session content and provider-rendered
assets are not yet represented by a single asset-origin registry. New external
scripts, frames, media, workers, or browser fetches must not be enabled by adding
a broad scheme wildcard without documenting the recipient/data flow. Prefer a
specific normalized origin and update public provider disclosure where data
leaves the deployment.

Jitsi must be regression-tested when CSP or Permissions-Policy changes. A header
that makes the page scanner pass while silently breaking camera/microphone/video
is a defect.

## Accessibility baseline

The report that triggered this baseline detected a serious colour-contrast
failure on the public landing surface. The warm palette now defines:

| Token | Value | Contrast on `paper` `#F0EEE6` | Contrast on `white` `#FAF9F5` |
|---|---:|---:|---:|
| `gray.500` | `#6D6759` | 4.84:1 | 5.34:1 |
| `clay.600` | `#A95134` | 4.62:1 | 5.09:1 |

White text on `clay.600` is 5.09:1. These ratios exceed 4.5:1 for normal text.
`--clay` matches `clay.600` so selection and caret theming do not reintroduce the
old lower-contrast accent.

This does not prove WCAG 2.2 AA conformance. Required deployment evidence still
includes public and authenticated journeys, keyboard-only operation, screen
reader semantics, focus order/visibility, 200%/400% zoom and reflow, errors and
status announcements, motion, timeouts, touch targets, PDFs, emails, charts,
calendar, video, and content authored by users.

### Public HUD tokens

The public site (spec 07 "Public site design system") has its own token set,
defined once in `components/hud/hud.module.css` and mirrored in
`lib/hud-tokens.ts`. The tokens exist only under the `HudShell` root, so the
signed-in app's palette above is unaffected. Day is the default; Night applies
when the visitor chooses it, or chooses Match device on a dark-scheme system.

| Token | Day | Night | Role |
|---|---|---|---|
| `bg` | `#F0EEE6` | `#1F1D1A` | Page ground (dot grid) |
| `surface` | `#FAF9F5` | `#282520` | Panels, strip, nav, footer |
| `sunk` | `#F5F4EF` | `#211E19` | Usual-way cells, table head, inline code |
| `ink` | `#1F1D1A` | `#F0EEE6` | Primary text |
| `ink-hover` | `#2E2A25` | `#CBC6BA` | Ink CTA hover fill |
| `graphite` | `#5D5749` | `#CBC6BA` | Body and secondary text |
| `caption` | `#6D6759` | `#A8A292` | 12px labels, dates, units |
| `clay` | `#A95134` | `#DF9377` | Clay text |
| `clay-strong` | `#A04A30` | `#E5AE97` | Link hover, missing disclosures |
| `clay-fill` / hover | `#A95134` / `#A04A30` | `#D97757` / `#DF9377` | Top rules, trace, ■, primary CTA, info chip |
| `on-clay` | `#FAF9F5` | `#1F1D1A` | Text on clay fill |
| `clay-wash` | `#FBF3EF` | `#413028` | Attention chip, missing disclosure, ledger footer |
| `edge` | `#1F1D1A` | `#A8A292` | 1px panel and control edges, CTA shadow |
| `hairline` | `#CBC6BA` | `#4A453D` | Decorative row dividers only |
| `focus` | `#A04A30` | `#DF9377` | 2px focus outline |
| `term-bg` / `term-ink` / `term-prompt` / `term-dim` | `#1F1D1A` / `#F0EEE6` / `#DF9377` / `#A8A292` | `#141210` / `#F0EEE6` / `#DF9377` / `#A8A292` | Terminal block |

Text pairs (4.5:1 required; WCAG 2.x formula):

| Pair | Day | Night |
|---|---:|---:|
| ink on bg / surface / sunk / wash | 14.47 / 15.96 / 15.27 / 15.35 | 14.47 / 13.14 / 14.30 / 10.77 |
| graphite on bg / surface / sunk / wash | 6.18 / 6.82 / 6.52 / 6.55 | 9.87 / 8.96 / 9.75 / 7.34 |
| caption on bg / surface / sunk | 4.84 / 5.34 / 5.11 | 6.60 / 6.00 / 6.52 |
| clay on surface / sunk / wash | 5.09 / 4.87 / 4.90 | 6.23 / 6.78 / 5.11 |
| clay on bg (14px and up only) | 4.62 | 6.87 |
| clay-strong on surface / wash / bg | 5.67 / 5.45 / 5.14 | 7.87 / 6.46 / 8.67 |
| on-clay on clay-fill / clay-fill hover | 5.09 / 5.67 | 5.39 / 6.87 |
| surface on ink / ink-hover (ink CTA, checked Display segment) | 15.96 / 13.52 | 13.14 / 8.96 |
| term-ink / term-prompt / term-dim on term-bg | 14.47 / 6.87 / 6.60 | 16.09 / 7.63 / 7.34 |
| ink on ECG 5 mm line / line crossing (hero word and tagline) | 12.10 / 10.89 | 10.58 / 9.58 |

Non-text pairs (3:1 required):

| Pair | Day | Night |
|---|---:|---:|
| edge on bg / surface | 14.47 / 15.96 | 6.60 / 6.00 |
| focus on bg / surface | 5.14 / 5.67 | 6.87 / 6.23 |
| clay-fill mark on surface / bg | 5.09 / 4.62 | 4.89 / 5.39 |
| clay-fill trace over an ECG 5 mm line | 3.86 | 3.94 |
| caption dashed edge on surface / sunk | 5.34 / 5.11 | 6.00 / 6.52 |
| clay border on wash | 4.90 | 5.11 |

Caption text directly on the ECG grid is forbidden: it measures 4.05 on a 5 mm
line and 3.64 on a crossing in Day (Night 4.83 / 4.37). That is why the strip's
"50 mm/s  10 mm/mV" caption sits on a surface backing. In Night the surface and
the ground differ by only about 1.1:1, so panels are always separated by their
6:1 edge, never by fill alone; panel borders must not be removed in Night.

Placement rules:

1. The smallest text is 12px, in caption colour or stronger. Only the
   aria-hidden status-chip glyphs (10px) are smaller; the chip's words carry the
   state.
2. Clay text at 13px or smaller sits only on surface, sunk, or wash, never on the
   page ground.
3. No text under 18px sits directly on the ECG grid, the nav ruler, or the dot
   grid. Small text there gets a backing (`.backed` in the page colour, or the
   surface).
4. Decorative marks never carry meaning: dots about 1.3:1, ruler ticks 1.88:1
   (Night 2.51:1), hairlines 1.47–1.77:1, ECG grid lines 1.1–1.32:1. A hairline
   is never the only boundary of a control.
5. State is never shown by colour alone: chips pair a glyph with words, the
   comparison cells use dashed versus solid edges plus labels, and the current nav
   item has a bar plus `aria-current`.

Enforcement: `lib/hud-tokens.test.ts` fails if the CSS token blocks and
`lib/hud-tokens.ts` drift apart (and if the Match device block differs from
Night); `lib/accessibility-colors.test.ts` asserts every `HUD_TEXT_PAIRS` entry
at 4.5:1 and every `HUD_UI_PAIRS` entry at 3:1; and `e2e/contrast.spec.ts`
measures every rendered text node on the nine public routes, in Day and Night,
against the background it is actually composited on (including the ECG grid's
worst pixel, where both 5 mm and both 1 mm lines cross), and enforces rules 1
and 3.

### Homepage motion and progressive enhancement

The landing `<h1>` is the calibration strip (`components/hud/CalibrationStrip.tsx`):
a 1 mV calibration pulse and one normal P-QRS-T complex drawn to scale on ECG
paper at 50 mm/s and 10 mm/mV, with the PETRIOS wordmark on the trace and the
tagline typed beneath it. The contract:

- **Server-rendered and CSS-only.** The wordmark and every tagline character are
  in the server HTML. The h1's accessible name is exactly “Petrios: The operating
  system for clinical teaching”: an sr-only colon makes `textContent` read that
  way, and the h1 also carries the string as `aria-label`, because some
  accessible-name algorithms pad the flex trace pieces with spaces. No script runs
  for the motion: no inline script, no canvas, no WebGL, no module loaded on
  demand, and no new CSP origin. Without JavaScript the page is complete; only
  the Display control and the mobile menu button are inert (both disabled until
  hydrated), and the footer links every page the menu does.
- **Typewriter.** `components/Typewriter.tsx` is a server component.
  `chunkForTyping` (`lib/typewriter.ts`) splits the text at spaces into the fewest,
  most even chunks of at most 21 characters (what fits 18px Plex Mono in the 320px
  hero). Each chunk is a nowrap inline block of real text, revealed one monospace
  advance per step with `clip-path: inset()` on `steps(n)`. `clip-path` never
  removes text from the accessibility tree, find-in-page, selection, or
  `textContent`. Layout is final from the first paint: chunks wrap whole on phones
  (two lines at 390px), and the h1 box never changes while typing. A caret rides
  the reveal edge; the block cursor then snaps on, blinks four times (1s each,
  inside the WCAG 2.2.2 five-second limit), and stays solid. A word longer than 21
  characters makes the text render statically.
- **One orchestrated moment.** About 1.5s of linear, left-to-right reveals at
  constant paper speed: lead-in, pulse outline, ■ fill, complex, lead-out, then
  the write-head (the site's only glow apart from the health check's "up" mark).
  The tagline types from 350ms at 27ms per
  character. No other page animates on load; there are no scroll reveals, loops,
  parallax, or sweeps. Client navigation back to `/` replays the strip once; the
  content stays readable throughout.
- **Reduced motion.** Every keyframe is declared under
  `prefers-reduced-motion: no-preference`, and the base styles are the final
  state. A `reduce` block also sets `animation: none` on every HUD element, so
  reduced motion shows the full trace, lit write-head, full tagline, and solid
  cursor at once.
- **Forced colours and print.** The grids, nav ruler, glows, and dot grid are
  removed. The trace, ■, cursor, and panel top rules use `CanvasText`. Print also
  drops the Display control, the health-check button, and shadows.
- **Geometry.** 1 mm is 4px, or 3px below a 480px hero container (a container
  query), where a QRS-only complex replaces the full complex. Only the trace
  clips (`overflow-x: clip` with a 4 mm clip margin); the strip itself does not,
  so the tagline can never be cut off, even under WCAG 1.4.12 text-spacing
  overrides at 320px. The aria-hidden caption sits on a surface backing.
- **Truth rule.** ECG vocabulary lives only in this strip and the nav ruler's
  time marks: no heartbeat icons, “HR”, “Lead II”, “bpm”, or invented vital signs
  anywhere on the site. The caption describes the drawing's scale only. The
  50 mm/s choice awaits UK clinician sign-off: at 25 mm/s the pulse would not be
  square and the drawn intervals would read as abnormal, so the drawing and the
  caption must change together if it is ever revised.

`e2e/landing.spec.ts` covers the accessible name, the no-JavaScript
`textContent` and inert controls, chunking at 700ms with no layout shift, reduced
motion, keyboard focus, overflow from 320px to 1440px, the tagline under 1.4.12
text spacing at 320px, decorative markers kept out of the accessibility tree,
and the absence of any canvas;
`lib/typewriter.test.ts` covers the chunking.

## Compliance evidence pack

`docs/compliance/` contains:

- a DTAC evidence workbook that separates product controls from operator proof;
- a detailed DPIA template with purpose-by-purpose lawful-basis and risk work;
  and
- an index pointing back to this canonical implementation contract.

Language such as “working workbook”, “template”, and “operator evidence” is
deliberate. Do not rename these as a completed DTAC, approved DPIA, executed DPA,
or accessibility certification unless the responsible organisation has actually
produced and signed that separate evidence.

## Verification contract

Changes to this surface require, at minimum:

- lint, TypeScript, unit tests, and production build;
- public browser smoke for all four compliance pages;
- response assertions for HSTS, CSP/default/frame ancestors, nosniff,
  anti-framing, referrer and permissions headers;
- a search for stale anonymous-feedback claims;
- contrast calculation for modified text/background tokens, and for the public
  site the `e2e/contrast.spec.ts` probe in Day and Night;
- the Display cookie and GPC disclosures (`e2e/public-pages.spec.ts`) when
  `/privacy`, `/privacy/choices`, or `lib/public-display.ts` changes;
- production fetch of public pages and headers after deployment;
- Jitsi join/camera/microphone regression where header source or permissions
  policy changes; and
- a rescan interpreted alongside manual review, not as certification.

Before release, an operator must also complete controller/contact/region/transfer
configuration, review the provider register, execute required contracts, approve
lawful bases/retention/DPIA, establish rights and incident processes, and retain
evidence that backups, access controls, monitoring, and accessibility work in the
deployed environment.

## Change checklist

- Does a new field, table, log, PDF, export, email, or public capability change
  the personal-data map or retention work?
- Does a new browser dependency require CSP/Permissions-Policy and recipient
  disclosure changes?
- Does an operator-configured provider remain visible without exposing internal
  URLs or secrets?
- Is feedback language precise for storage, model input, output, teacher release,
  public display, and audit separately?
- Is a consent/choice control functional before processing rather than cosmetic?
- Does new device storage (cookie, localStorage, IndexedDB) on any surface fit the
  Cookies posture, and is it disclosed on `/privacy` in the same change?
- Are controller/processor/legal conclusions left to the parties with evidence?
- Do colour and interaction changes retain automated and manual accessibility
  evidence?
- Have specs 05/06/09/11/12 and public notices changed where the underlying
  subsystem behaviour changed?
