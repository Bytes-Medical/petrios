# 04 — Sessions, teachers, calendars, and teaching slots

## Session aggregate

A `sessions` row is the anchor for scheduling, attendance, feedback, teachers,
Recall, certificates, communications, newsletters, and reporting. It
belongs to one organization and one department and records a creator, title,
description, start/end, location, optional session type, lifecycle status, and
subsystem settings/watermarks.

The implemented location values are:

| Value | Meaning | Join URL resolution |
|---|---|---|
| `MS_TEAMS` | Remote Teams meeting | Stored `teams_meeting_url` |
| `IN_PERSON` | Physical attendance | No remote URL |
| `HYBRID` | In-person plus Teams | Stored `teams_meeting_url` |
| `JITSI` | Petrios Meet video room | Derived Jitsi URL |

The optional session-type vocabulary is `STEPP`, `CLINICAL_SKILLS`,
`SIMULATION`, and `ACADEMIC`. It is classification metadata, not authorization
or learning-outcome evidence by itself.

## Status and lifecycle

Persisted status is `DRAFT`, `PUBLISHED`, or `CANCELLED`.

```text
create -> DRAFT <------> PUBLISHED
           |                 |
           +-------> CANCELLED
                        |
                        +-- update action can set another status
```

The current update action accepts any `SessionStatus`; the state machine is not
irreversible. The UI supports publishing, returning a published session to
draft, and cancelling. A future “terminal cancellation” rule would need server
validation and probably a migration—not just a disabled button.

Rules enforced by the server:

- a session end must be strictly after its start;
- publishing is blocked when end is less than or equal to the current time;
- creation/update requires department-moderator authority for the session's
  department;
- bearer API creation verifies the department belongs to the token's
  organization, creates only `DRAFT`, and attributes `created_by` to the
  department creator because API tokens have no user;
- bearer API publish is idempotent when already `PUBLISHED` and blocks an ended
  session.

The interactive date/duration UI normally offers 30–240 minutes, commonly in
30-minute steps. The server does **not** enforce those duration bounds; it only
enforces valid dates and `end > start`. Editing preserves exact off-grid
durations. Teaching slots have their own duration rules below.

Session deletion is a moderator operation and cascades or nulls dependent data
according to migration foreign keys. Deletion is not a soft-cancel and must not
be used when audit retention is required.

## Visibility and authorization

RLS and DAL queries distinguish publication:

- organization members can see published sessions in their permitted scope;
- drafts and cancelled sessions are limited to organizer roles, the creator, and
  assigned teachers as encoded by policies/queries;
- management actions re-resolve the session under the current organization and
  require its department moderator;
- public feedback, RSVP, calendar, verification, and Recall surfaces use a
  purpose-specific public/capability read rather than general session access.

Every action taking `sessionId` must obtain department and organization from the
resolved row; a client-provided department is not authorization.

## Publication effects

Changing from a nonpublished status to `PUBLISHED` emits the best-effort
`session.published` webhook. The action updates the session first and does not
roll it back if delivery fails. Moving back to draft does not revoke emails,
calendar entries already cached by clients, certificates, feedback, or related
records.

Publication makes the session eligible for reminder, feedback, calendar, Recall,
Ops, and reporting selectors, subject to each selector's time and watermark
rules. It does not automatically invite teachers or recipients.

## Meeting URL contract

All outbound surfaces should use `sessionMeetingUrl`:

- `JITSI`: `https://<NEXT_PUBLIC_JITSI_DOMAIN>/Petrios-<session UUID>`;
- `MS_TEAMS`/`HYBRID`: the stored Teams link;
- `IN_PERSON`: null.

The Jitsi domain defaults to `meet.jit.si`. A UUID-derived room is difficult to
guess but is still a bearer-style URL; Petrios does not provision Jitsi users,
passwords, or lobby policy.

The in-app Petrios Meet room is displayed from 30 minutes before session start
through 30 minutes after session end. Opening the room attempts best-effort self
check-in, whose independent attendance window may reject it. A raw Jitsi URL can
be joined outside the Petrios UI window if the meeting provider permits it.

The session-management **Overview** tab contains the meeting control. Jitsi
sessions show the derived guest URL; Teams/hybrid sessions use the editable
stored URL form. There is no separate Meeting Link tab.

## Registered teacher assignments

`session_teachers` links an auth user to a session. A moderator may assign only a
current member of that session's department. A new assignment is `PENDING` and
records the inviter.

The invited user can respond once while status is `PENDING`:

- accept uses a compare-and-set to `ACCEPTED` and notifies the inviter (or
  session creator) by bell/email;
- decline changes to `DECLINED`;
- repeated response is rejected.

Notification failure does not revert the accepted/declined state. Assignment
acceptance describes teaching responsibility and does not prove physical
attendance. After the session ends and attendance governance is finalized, the
accepted assignment is the recognition basis for a teaching certificate; it
does not create an attendance result. See specs 03 and 05.

Removing an assignment deletes the relationship; it does not remove previously
created attendance evidence or certificates.

## External teacher invitations

`teacher_invitations` represents a teacher with no required auth account.

1. A moderator supplies an email and optional names.
2. Email is normalized. A second pending invite for the same session/email is
   rejected.
3. An 8-character invite code is stored and an invitation row is durable before
   email is attempted.
4. The address book is best-effort upserted, filling blank names only.
5. Invitation email is attempted. Failure is returned as `emailSent: false` but
   does not remove the invitation.
6. The public RSVP page resolves the code. A pending invite can be accepted or
   declined once, with required self-reported names.
7. RSVP names overwrite address-book names because the contact is treated as the
   authoritative source.

An accepted external teacher is included in session reminders and selected
teacher-release flows. Acceptance does not create an internal user, department
membership, or attendance evidence. After an ended session is finalized, the
matching accepted invitation is sufficient teaching-certificate identity and
assignment evidence. External identities are primarily joined by normalized
email.

## Address book and contact groups

Organization managers maintain `external_contacts`; contacts are unique by
case-insensitive email within an organization and can be archived/reactivated.
Inviting an archived address reactivates it through the upsert path.

`contact_groups` are organization-scoped with case-insensitive unique names;
`contact_group_members` maps contacts into reusable audiences. These tables are
not a mailing list consent model. An Ops newsletter has a separate unsubscribe
table and targets organization members, while slots target the explicit audience
snapshot described below.

## Calendar subscription

`GET /api/calendar/ics` is a public, cookie-free ICS feed. The URL contains:

- `orgId`;
- a deterministic token computed from `orgId + SUPABASE_SERVICE_ROLE_KEY` using a
  32-bit JavaScript integer hash; and
- optional `departmentId`.

After token validation, it returns published organization sessions (optionally
filtered by department), title, description, times, location, and meeting URL.
It uses `PUBLISH`, one-hour TTL metadata, and response headers that disable HTTP
caching.

Security limitations:

- the token is a short, noncryptographic deterministic hash, not an HMAC;
- it rotates whenever the service-role key changes;
- it appears in query strings and should be treated as a capability secret;
- `departmentId` is not cryptographically bound separately—the token authorizes
  the organization feed and the server applies the requested filter; and
- there is no revocation per subscriber or feed URL.

Do not describe this as strong signed calendar authorization. A replacement must
use random stored/revocable feed credentials or a modern MAC and preserve legacy
rotation behavior deliberately.

## Session reminders

The cron-authenticated reminder route selects at most the DAL batch cap of
published sessions with null `reminder_sent_at`, starting after now and no later
than 24 hours from now.

Recipients are:

- every department member;
- accepted registered teachers, including accepted teachers reached outside the
  normal department list; and
- accepted external teacher invitations.

Registered profiles and external invitations are deduplicated by lower-cased
email, with the registered profile winning. The email includes date/time,
location, resolved meeting URL, and session link.

Thrown failures are isolated per recipient. The mail adapter also reports
provider failure as `{ error }`, but this job does not inspect that result: it
increments `emailsSent` as if delivery succeeded. After the loops the session
watermark is written even if sends throw, return an error, or the session has no
recipients. The reminder route is therefore idempotent at session level but is
not a per-recipient retry queue or delivery guarantee.

## Post-session reporting eligibility

The post-session report job processes published sessions whose end is at least
24 hours in the past and whose report watermark is null, with a fixed batch cap.
It does not recompute or infer attendance. Sessions remain unwatermarked until a
moderator finalizes attendance. The job then emits the attendance event for that
final revision and issues attendee recognition through the per-recipient
delivery ledger described in specs 03 and 05. It does not issue teacher
certificates.

## Session documents

Every session page has a Documents tab. Metadata lives in the deny-all-RLS
`session_documents` table and objects live in the private Supabase Storage bucket
`session-documents`. No public bucket URL or general browser object policy is
created.

### Upload authority and limits

A department moderator or an `ACCEPTED` registered session teacher may upload.
The action re-resolves session and organization scope before using the service
DAL. Other session users can list/download documents if the normal session read
authorizes them; archived objects are visible only in the moderator management
view and are not downloadable.

Supported formats and exact MIME types are:

| Extension | MIME type | Browser behavior |
|---|---|---|
| `.pdf` | `application/pdf` | Same-origin authenticated inline view or download |
| `.docx` | Open XML Word MIME | Download |
| `.pptx` | Open XML PowerPoint MIME | Download |

The maximum is 25 MiB in application validation, Next Server Action body
configuration, bucket configuration, and the database check. Legacy `.doc`,
`.ppt`, macro-enabled files, and all other formats are rejected.

### Validation and storage sequence

The server sanitizes path/control characters from the display filename, checks
extension/MIME agreement and size, reads the bytes, and then performs basic
content validation:

- PDF must begin `%PDF-`;
- Office files must have a ZIP signature, `[Content_Types].xml`, and the correct
  `word/` or `ppt/` package prefix; and
- any package containing `vbaProject.bin` is rejected.

After validation it calculates SHA-256 and uses an unguessable object path:
`<org>/<session>/<document UUID>.<extension>`. Metadata transitions
`UPLOADING/PENDING` to `AVAILABLE/BASIC_VALIDATED` only after object storage
succeeds. Failure marks the row `REJECTED` and attempts object cleanup. Upload
and archive actions append session activity events. Completed permanent
deletions append an operational activity event on a best-effort basis.

`BASIC_VALIDATED` is deliberately not called malware-scanned. Package-marker
checks do not replace antivirus/content-disarm scanning. The UI tells users to
treat downloaded Office content as untrusted. A deployment requiring malware
assurance must add a quarantine/scanner transition before `AVAILABLE` and must
not simply relabel this state.

### Audio Recap learning-source use

The Audio Recap generator uses every currently `AVAILABLE` session document as
its learning material. It does not use the session description, tags, or
feedback themes as substitute teaching content. Generation is an explicit
moderator action and fails when there is no available document.

The server reauthorizes session moderation, lists source metadata through the
document DAL, enforces the provider's 50 MiB combined file-input limit, downloads
the private objects, and verifies each byte count and SHA-256 before inference.
PDF, DOCX, and PPTX bytes are then sent to the configured AI provider through an
OpenAI Responses-compatible file-input call. PDFs contribute extracted text and
page images; DOCX/PPTX contribute extracted text, so embedded Office-only charts
or images may not inform the recap. Users are warned before upload/generation not
to include patient-identifiable, confidential, or unnecessary special-category
material.

In the same provider request, generation requires hosted web search limited to
the authoritative clinical/evidence domains specified in spec 06. Search queries
may be derived from the private learning material. Research can add relevant
current guidance, definitions, safety context, or evidence, but the uploaded
documents must determine the recap topic, structure, and clear majority of its
content. Research must not silently override a document; a material conflict is
surfaced neutrally for moderator review. The generated target is 650–800 spoken
words (about five minutes), with no spoken URLs or citation list.

The recap row snapshots the sorted source document id, filename, MIME type,
byte size, and SHA-256 list plus a canonical digest. Generation, audio creation,
approval, attendee metadata visibility, and audio streaming compare that digest
with the current available set. Uploading, archiving, deleting, replacing, or
otherwise changing the available set makes the old recap stale and unavailable
until a moderator regenerates, listens, and approves it. Legacy recaps without a
source digest are stale by definition.

The recap also stores de-duplicated HTTP(S) URL/title citations returned by the
hosted search and shows them as external links beside both the moderator draft
and the approved attendee player. These are review aids, not a frozen evidence
snapshot: Petrios does not store the public page body and a later page change
does not automatically mark a recap stale. Research provenance and document
provenance therefore have deliberately different freshness semantics.

Because one server action performs file ingestion, research, and drafting, the
client cannot observe provider-native completion percentages. While generation
is pending, the Recall UI shows an explicitly labelled **estimated** progress bar
with stages for verification, reading, research, drafting, and finalisation. It
advances toward (but not beyond) 94% until the server succeeds, then reaches 100%;
an error replaces the pending state with the provider-safe failure message.

### Download, archive, and permanent delete

The same-origin download route requires authentication and current organization
session access, then matches document id, session id, org id, and `AVAILABLE`
status before a service-role object read. Responses use the stored MIME type,
safe RFC 5987 content disposition, `private, no-store`, and `nosniff`. Only PDFs
honor `?view=1` as inline; Office files always download, so no Word/PPT webviewer
or conversion service is introduced.

Archiving is moderator-only, stamps actor/time, prevents future route lookup,
and preserves the private object for audit/retention. It is not secure deletion.

Permanent deletion is a separate, explicitly destructive action exposed as
**Delete permanently**:

- a department moderator may delete any `AVAILABLE` or `ARCHIVED` document in
  the session;
- an uploader may delete a document only when `uploaded_by` matches their
  authenticated user id;
- the ordinary Documents tab shows the button only for the current uploader,
  while Manage Session shows it for the moderator on both available and
  archived rows; and
- the browser requires confirmation explaining that the stored file is removed
  and the action cannot be undone.

The server re-resolves the session under the current organization, matches the
document by document/session/organization, and repeats the moderator-or-uploader
authorization; UI visibility is not the security boundary. It removes the
private storage object first, then hard-deletes the `session_documents` metadata
row. Removing bytes first avoids leaving an inaccessible bucket orphan when the
database succeeds but storage fails. If object removal succeeds and metadata
deletion fails, the row can temporarily remain and a retry treats a missing
object as already removed before deleting the row.

After both deletions complete, `SESSION_DOCUMENT_DELETED` is written to
`session_activity_events` with document id and filename. That event is
best-effort because activity is an operational projection rather than the
deletion transaction: failure to write it does not resurrect the object or turn
a completed deletion into an application error.

“Permanent” describes removal from the live Petrios database and private
bucket. It does not promise immediate erasure from storage-provider backups,
database backups, infrastructure logs, or other copies governed by operator
retention. The activity event deliberately retains the document id and filename.

Session deletion cascades metadata and follows the storage provider's separate
object-lifecycle behavior; operators must test cleanup/retention rather than
assuming a relational cascade deletes bucket objects.

Current limitations: there is no antivirus service, Office-to-HTML conversion,
version-replacement UI, background orphan cleanup, retention job, or public
sharing link.

## Teaching slot model

`teaching_slots` are moderator-created opportunities that can be offered to
registered members or external contacts.

Persisted statuses:

- `OPEN`: claimable while `date_start > now`;
- `CLAIMED`: won by one recipient and normally linked to a generated draft
  session;
- `CLOSED`: manually withdrawn.

`EXPIRED` is presentation-only: an open slot whose start is at or before now. No
job writes that value.

### Creation and duration

A parent slot range must be 30–240 minutes and cannot use a past calendar day.
It may be split into 10-, 15-, or 20-minute lightning slots. Splitting happens
after parent validation and drops a trailing remainder shorter than the split
size. A slot of 20 minutes or less is labelled Lightning.

The uniqueness constraint prevents another active (`OPEN`/`CLAIMED`) slot at the
same department/start identity. It does not prohibit differently-starting time
intervals from overlapping.

Moderators may close only `OPEN` slots. They may delete `OPEN` or `CLOSED` slots,
but not `CLAIMED` slots through the slot action.

### Publication and audience snapshot

A publication requires at least one selected open future slot and one audience:

- selected contact groups;
- all department members; and/or
- all organization members.

The publisher is removed from the member audience. Active group contacts and
member profiles are resolved, then deduplicated by normalized email; a registered
member wins over an external contact with the same email.

The service stores:

- the publication and requested audience flags/group ids;
- the exact selected slots in `slot_publication_slots`; and
- one `slot_claim_links` recipient snapshot.

Registered recipients have `user_id` and no public claim code. External contacts
have a 12-character capability code and contact id. Email is attempted after the
snapshot commits; failures are counted but do not remove the publication. A
registered recipient also gets a best-effort in-app notification.

The snapshot means later group membership changes do not change who was offered
that publication.

### First-come-first-served claim

A member claim requires:

- an authenticated current organization;
- a slot in that organization; and
- any publication claim link connecting that user to the slot.

An external claim requires:

- a valid 12-character claim-code record;
- an offered slot from that publication; and
- the associated contact identity.

The winning operation is one database update with predicates `status = OPEN` and
`date_start > now`. It records claimant identity/name/topic and changes the slot
to `CLAIMED`. Losers receive a “just claimed” error.

After winning, orchestration:

1. creates a `DRAFT` session using the suggestion or “Teaching session — topic
   TBC” and attributes creation to the original slot creator;
2. for a registered user, inserts an `ACCEPTED` session-teacher row without
   creating attendance evidence;
3. for an external contact, inserts an accepted external invitation but no
   attendance evidence;
4. links the slot to the new session;
5. emits best-effort `slot.claimed`; and
6. best-effort notifies the slot creator by bell and email.

The cross-table sequence is not a database transaction. On a failure during
steps 1–4, the code compensates by reopening the slot. If a session or teacher
row was already created before a later failure, compensation does not delete
that orphaned side effect. Operators and future changes must not call the flow
fully atomic.

Deleting a session with ISSUED CERTIFICATES is blocked entirely
(`countCertificatesForSession` guard in `deleteSession`) — certificates are
durable, publicly verifiable records and `certificates.session_id` is ON
DELETE CASCADE; the moderator is told to cancel the session instead.
Deleting an ACCEPTED external invitation that belongs to the session's
slot claimer is likewise blocked ("cancel or delete the session instead")
— that invitation is the external's only attachment to the session.
Deleting the generated session **closes** its claimed slot
(`closeSlotForSession`, run before the delete while `session_id` still
points at it) — never reopens it, since silently re-advertising a date the
claimer still believes they teach would be worse than the moderator
recreating the slot deliberately. Slots orphaned by historical deletes
(CLAIMED with a NULL `session_id` from the FK's ON DELETE SET NULL) are
self-healed to CLOSED by `getDepartmentSlots` on the next schedule visit;
without that they tag their date busy forever and block the partial unique
index. Reopening remains a separate, explicitly authorized workflow.

## Scheduling change checklist

- Preserve tenant/department authorization on every session and slot selector.
- Define server-side date, duration, and status validation; UI validation alone
  is advisory.
- Decide how edits affect already-sent reminders, invites, ICS caches, Recall,
  and report watermarks.
- Use `sessionMeetingUrl` for new outbound surfaces.
- State teacher status filters explicitly (`PENDING`, `ACCEPTED`, `DECLINED`).
- Keep slot claim concurrency in a database predicate and document compensation.
- Treat invite, claim, and calendar codes as capabilities and avoid logs.
- Add forward migrations/tests/spec changes for any new status or location.
