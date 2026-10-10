# 14 — Rota availability (rota-aware teaching)

## Purpose and status

Rota availability lets a department learn, per trainee and per teaching
session, whether the trust rota had the trainee **rostered unavailable**: on
duty elsewhere, on nights or post-night rest, not working, or on leave. Phase 1
uses that one fact in two places:

1. **Attendance.** After a session ends, the moderator's *Expected roster*
   panel shows `Suggested: excused (rostered unavailable)` against trainees the
   rota had away. The moderator confirms or dismisses each row. Petrios never
   changes attendance on its own.
2. **Catch-up.** A trainee whose finalized result is `EXCUSED` keeps the Audio
   Recap catch-up (spec 08). This applies to every excused expected attendee,
   not only rota excusals, and activates when migration 064 is applied.

Implemented scope (Phase 1): the kill switch, per-organisation enablement with
governance fields, department enrolment, the narrow rota-uploader grant, the
in-browser CSV pipeline (parser, mapping profiles, code dictionary, post-night
rest), the minimised payload and its server action, the transactional ingest
RPC, moderator-confirmed identity links, session flags (only for unavailable
people), suggestions with an individual transactional confirm, the trainee's
own notice and contest, the Recall widening to finalized `EXCUSED`, the purge,
and session/membership hooks.

Not implemented: scheduling availability counts (Phase 2) and the push API
(Phase 3). They are described only in the RFC section at the end, and no route,
table, or setting for them exists.

Storage is migration `063_rota_availability.sql`; the Recall widening and the
primary-evidence rule are migration `064_recall_excused_catchup.sql`. Both are
files that the owner applies, in the same release (either order); the feature
is inert until **both** are applied **and** the switches below are on. Rota
counts as "not installed" until 064's marker
`recall_catchup_eligible_statuses_v1()` exists and includes `EXCUSED`, because a
confirmed rota excusal makes a trainee `EXCUSED` and only 064 keeps their
catch-up route (owner decision O2); `confirm_rota_excusal_v1` checks the same
marker.

## Non-negotiable invariants

1. **Rota data never decides attendance.** Every excusal is an individual
   moderator decision recorded as `MODERATOR_CONFIRMATION` evidence. There is
   no bulk accept and nothing is pre-selected. Finalization never reads rota
   data and is never blocked by missing, stale, or wrong rota data. A rota
   "available" result never creates attendance.
2. **No category is stored or shown anywhere.** All leave types (sickness,
   annual, study, parental, union, and others) collapse to the letter `L` in the
   coordinator's browser before anything is sent. Moderators see only
   "rostered unavailable". Sickness can never be distinguished from other
   unavailability on any surface, column, log, or export.
3. **No person-level rota grid is ever stored.** The server receives a per-day
   status grid for the duration of one request, computes session flags, and
   discards it. The raw file, shift codes, names, and leave reasons never leave
   the browser.
4. **Identifiers are never stored in clear.** Staff numbers and emails reach the
   server only to compute a keyed HMAC and look up links; they are never
   stored, logged, or passed to an RPC. RPCs receive only user ids, HMACs,
   session ids, and counts.
5. **Off by default, inert before migration.** Nothing reads or writes a rota
   object unless the kill switch is exactly `"true"`, `ROTA_IDENTITY_SECRET` is
   at least 32 bytes, 063 and 064 are applied, the organisation is enabled,
   and the department is enrolled. A missing table or function is
   "unavailable", never a 500 and never an error log. The exceptions are
   deletion only: the purge (see Retention) and the org admin's and
   moderator's cleanup actions (see "Cleanup with the switch off"), which also
   read the organisation's `rota_settings` row so Settings can offer them.
6. **Per-person rota status is visible only to the session's own moderators
   and to the trainee themself.** Super admins, teachers, faculty, uploaders,
   API clients, and reports see none of it.
7. **No trainee self-linking.** Only a moderator can confirm which account a
   rota row belongs to. A trainee can only contest a flag.
8. **Tenant scope comes from the caller.** The organisation is the caller's
   current organisation; the department must belong to it. The request body
   never supplies an organisation.

## Enablement and kill switches

Availability is evaluated in this order by `getRotaAvailability(orgId,
departmentId?)` (`lib/rota/access.ts`), and the first failure is the reason:

| Order | Check | Reason when it fails |
|---|---|---|
| 1 | `ROTA_INTEGRATION_ENABLED` is exactly `"true"` (`isRotaKillSwitchOn`, `lib/rota/config.ts`) | `kill_switch` |
| 2 | `ROTA_IDENTITY_SECRET` is at least 32 bytes of UTF-8 (`getRotaIdentitySecret`; logs "ROTA_IDENTITY_SECRET missing or too short" once, never the value) | `secret_missing` |
| 3 | The 063 objects exist (`RotaNotInstalledError` otherwise) **and** 064's `recall_catchup_eligible_statuses_v1()` includes `EXCUSED` (read once per request through `listCatchupEligibleStatusesAsSystem`) | `not_installed` |
| 4 | `rota_settings.enabled` for the organisation | `org_disabled` |
| 5 | The department is in `rota_departments` (when a department is given) | `department_not_enrolled` |

The kill switch is pinned to `"false"` on the Cloudflare staging Worker and in
the production preflight environment because both serve the production
database; the deploy validators refuse any other value there (spec 09,
`docs/cloudflare-workers.md`). `env.production` declares it as well (`"false"`
until go-live), because both production phases must declare the same `vars`
keys and share one Worker's secrets; it is the one key allowed to differ
between them (preflight `"false"`, live `"false"` or `"true"`). At go-live the
owner changes only the live value to `"true"` (on Render, the environment
variable). There is no fallback for the secret: an 8-digit staff
number is trivially brute-forced against a salt alone.

Every DAL function in `lib/db/rota.ts` maps PostgREST `PGRST205`/`PGRST202` and
Postgres `42P01`/`42883` to `RotaNotInstalledError`. Callers treat it as
"Rota availability is not available.".

### Organisation enablement

Org admins of the current organisation manage the "Rota availability" section
in Settings. While rota is available it shows every control; with the kill
switch off (or the secret missing, or 064 not applied) it appears only when the
organisation still holds rota data or grants, in **cleanup-only** mode (below).

- **Governance** (`saveRotaGovernance`): a DPIA reference (3–120 characters),
  confirmation that the staff privacy notice has been updated, retention days
  (1–90, default 30), and scheduling horizon days (7–84, default 56). Saving
  never flips `enabled`.
- **Enable** (`enableRota`) refuses without governance ("Enter the DPIA
  reference and confirm the privacy notice first."). The database check
  `rota_settings_enable_requires_governance` enforces the same rule.
- **Disable** (`disableRota`) requires the typed confirmation `DISABLE` and
  calls `disable_rota_for_org_v1`: it deletes the organisation's flags and
  identity links, sets `enabled = false`, and keeps upload profiles, uploader
  grants, enrolled departments, batch audit, and preview audit (none of which
  holds rota status).
- **Department enrolment** (`setRotaDepartmentEnrolment`): the department must
  be in the caller's organisation; a composite foreign key on
  `(department_id, org_id)` also refuses a cross-organisation department.
  **Remove** asks for confirmation first ("deletes the department's rota
  suggestions now and removes its rota uploaders").
- **Uploader grants** (`grantRotaUploader` by email, `revokeRotaUploader`): the
  grantee must already be a member of the organisation and must **not** be a
  trainee of that department (`trainee_uploader`: such a person could match
  themselves and send themselves as available, deleting their own open
  flags). The grant is per department.

### Cleanup with the switch off

Deleting stored rota data must never depend on the switch that an emergency
turned off. The deletion-only actions use their own guards
(`requireRotaOrgAdminForCleanup`, `requireRotaModeratorForCleanup` in
`lib/rota/access.ts`): the caller's role and migration 063 are required, the
kill switch, the secret, 064, and the org setting are not.

| Action | Guard while rota is available | With the switch off |
|---|---|---|
| Disable and delete (`disableRota`) | org admin | allowed (cleanup) |
| Remove a department (`setRotaDepartmentEnrolment(id, false)`) | org admin | allowed (cleanup) |
| Remove an uploader (`revokeRotaUploader`) | org admin | allowed (cleanup) |
| Revoke an identity link (`revokeRotaLink`) | rota moderator | allowed (cleanup) |
| Governance, enable, enrol, grant, upload, link, confirm, dismiss, contest | full guard | refused |

`getRotaAdminState` returns `cleanupOnly: true` when the full guard fails as
"unavailable" but the organisation's `rota_settings` row exists and it is
enabled, has enrolled departments, or has uploaders. Settings then shows a
notice, the Disable control, the enrolled departments with **Remove**, and the
uploaders with **Remove** only. With nothing stored, the section stays hidden
while the switch is off.

## Roles and authorization

| Actor | Can | Cannot |
|---|---|---|
| Org admin of the current organisation | Settings, governance, enable/disable, enrolment, uploader grants; everything a department moderator can do | Act in another organisation |
| Department moderator (`department_admin` row whose department **and** organisation match) | Upload, see the department roster during matching, confirm identity links, link a trainee by staff number or email, see and revoke linked staff, see suggestions, confirm, dismiss | — |
| Rota uploader (`rota_uploaders` grant; never a trainee of the department) | Upload rows from their one preview per upload, save/delete mapping profiles, see "matched / not matched" booleans and the upload's coordinator counts | See names, the roster, user ids, flags, suggestions, or any count that reveals a flag or a decision (inserted/deleted flags, decision marks, rejected rows, links); send an identity link |
| Trainee | See their own flag for a session at any time; contest it | See anyone else's flag; link an identifier |
| Super admin acting in another organisation | Nothing | Read flags, see suggestions, confirm, dismiss |

`requireRotaModerator(departmentId)` decides in the pure `decideRotaModerator`
(`lib/rota/authz.ts`) from four facts: the department's organisation, the
caller's current organisation, whether the caller is org admin of the current
organisation, and the organisations of the caller's moderator rows for that
department. Super-admin status is **not an input**, so it grants nothing. This
is deliberately stricter than `requireDepartmentModerator`, which lets a super
admin moderate any department (spec 07). Every per-person rota read and every
rota mutation goes through this guard, `requireRotaUploaderOrModerator`, or
`requireRotaOrgAdmin`, apart from the deletion-only cleanup guards above. Each
guard checks the two environment conditions (kill switch, secret) first, then
authorization, and only then installed / org enabled / department enrolled, so
a caller without a rota role always gets "forbidden" and cannot learn whether a
department uses rota.

## Coordinator upload (browser)

Pages: `/rota` lists the departments where the caller can upload (moderated
enrolled departments plus uploader grants); `/departments/[id]/rota` hosts the
wizard (`RotaUploadLazy` → `RotaUploadWizard`), the moderator-only *Linked
staff* panel, and only the times of the latest as-worked and planned uploads
(no per-batch counts). Both return 404 when rota is unavailable or the caller
has no rota role. There is no Nav link: org admins reach `/rota` from Settings,
and coordinators and moderators are given the URL (docs/rota.md has a
coordinator quick guide).

The wizard generates an upload id and both batch ids when it mounts, so a double
submit is an idempotent replay. Steps:

1. **File.** CSV only, at most 10 MiB and 20,000 rows, parsed by the in-repo
   RFC 4180 parser `lib/rota/csv.ts` (quotes, escaped quotes, CRLF/LF, BOM;
   errors give line numbers and never cell values). There is no `xlsx`
   dependency.
2. **Layout and columns.** `WIDE` (one column per date) or `LONG` (one row per
   duty); staff id, email, name, date, code, start, and end columns by header
   name; date format `DD/MM/YYYY` (default), `YYYY-MM-DD`, or `DD-MMM-YYYY`;
   optional assignment-suffix stripping for staff ids. A five-row preview stays
   in the browser. `extractRotaRows` reports how many dates it recognised
   (header columns for `WIDE`, distinct duty dates for `LONG`), how many fall in
   the upload window and the window's first and last date; the step shows
   "N dates recognised in the upload window (dd/mm/yyyy to dd/mm/yyyy)" and
   **Next stays disabled** with "No column headers read as dates. Check the
   date format…" (or "No dates fall inside the upload window…") when none do.
   People with no coded day in the window are left out and counted.
3. **Code dictionary.** Every distinct code is listed with its frequency and
   must be mapped to a letter or to *ignore* before submit is enabled
   (`unmappedCodes`). Codes may carry default start/end times and a **Night**
   tick. A night-ticked code must map to `N` or `D` and carry both times. Each
   row says how it will be read: an untimed `N` is "a whole rest day. For a
   night shift, tick Night and add times."; a night (below) is "Night:
   post-night rest follows a run of these."; a timed `D` crossing midnight
   without the tick suggests ticking it. In a multi-code cell such as `LD/OC`
   (split on `/`, `+`, `,`) any non-`A` letter wins.
4. **Post-night rest.** On by default: after the last night of a run, `N` from
   the night's end for 46 hours (a night ending D+1 09:30 rests until D+3
   07:30). The trigger is any night run (default) or only runs of three or
   more nights, set per profile, and the rule can be switched off. A **night**
   (`isNightCode`, `lib/rota/dictionary.ts`) is a code ticked Night (`N` or
   `D`) or a timed `N` whose times cross midnight; it is read from the codes,
   never from the merged segments, so an explicit code next morning cannot
   hide it. The run ends when the last night's shift ends the next morning
   (taken from the code's end time even when that morning has a whole-day `X`
   or `L`), else at 24:00 of the last night. Explicit codes win **only on the
   minutes they cover**: inferred rest fills the rest of each day, so a new
   night starting inside the rest window keeps its daytime hours as rest, and
   an explicit day shift inside the window keeps its hours.
5. **Identity.** One preview call (below). Moderators confirm name or email
   suggestions per row; nothing is pre-ticked for names.
6. **Summary.** Counts only, including "N rota rows not matched" and "N new
   unmatched since last upload". A coordinator never sees link counts.

The wizard's step text derives the horizon from the organisation's setting
("two weeks back to N weeks ahead"), shows dates as `dd/mm/yyyy`, announces
errors (`role="alert"`) and moves focus to each step's heading.

Mapping profiles (`rota_upload_profiles`) save only header names, the date
format, the code legend, and the post-night rule (zod `.strict()`, at most 200
codes of at most 16 characters from `[A-Za-z0-9 /+_-]`, header names at most 80
characters, 32 KiB). They hold no person data.

### Status letters and day templates

| Letter | Meaning | Counts as unavailable |
|---|---|---|
| `A` | Available (a normal day shift is available: teaching is protected time) | No |
| `D` | On duty elsewhere (on-call or a clashing long day, set per code) | Yes |
| `N` | Nights or post-night rest | Yes |
| `X` | Not working | Yes |
| `L` | Leave of any kind | Yes |

There is no study-leave letter and no category. Each person-day is one
character pointing into a template table of local wall-clock segments
`["HH:MM","HH:MM",letter]` (`24:00` allowed as an end). `.` means no data.
Minutes a template leaves uncovered are **unknown**, never "not working". `L`
and `X` are always a single `00:00–24:00` segment, so leave types cannot be
told apart by their hours. A night crossing midnight is split over two days.
Templates are de-duplicated to at most 62 ids (`[a-zA-Z0-9]`).

The DST error is bounded and documented: post-night rest uses wall-clock
arithmetic, so a rest period spanning a clock change is off by ±1 hour.
Segment expansion to instants (`lib/rota/expand.ts`) is DST-safe through
`appWallClockToIso` in `APP_TIME_ZONE`.

### Batches and the minimised payload

The browser splits one export into two batches by `appDayKey()` "today":
days before today become a `WORKED` (as-worked) batch and days from today a
`PLANNED` batch. `submitRotaUpload` is called once per batch, `WORKED` first,
with the upload id of the wizard's one match preview; the database accepts at
most one batch of each kind per upload (`UNIQUE (org_id, upload_id, kind)`).
The batch range is only the dates that actually carry codes in the file,
clipped to today − 14 … today + horizon, so sessions after the end of the
export are never cleared as "unknown". Rows the preview did not match and the
moderator did not confirm are dropped in the browser (at most 500 rows are
sent); their count travels as `notSentCount` (a number only) and is added to
the batch audit's `people_unmatched`, which is what "new unmatched since the
last upload" compares against.

```jsonc
{ "v": 1, "batch_id": "uuid", "kind": "WORKED|PLANNED",
  "range": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },   // APP_TIME_ZONE dates
  "templates": { "a": [["08:30","17:00","A"]], "l": [["00:00","24:00","L"]] },
  "people": [ { "ref": "r17", "staff_key": "…", "email": "…",
                "link": { "user_id": "uuid", "origin": "MODERATOR|EMAIL_MATCH" },
                "days": "aa.l…" } ] }
```

The payload carries no names, no shift codes, and no other columns. `ref` is
the row index (`r` + n). `link` is present only on a moderator's upload and
only for a person the moderator confirmed; its `origin` is ignored by the
server (see Identity matching). The browser also sends `payloadSha256`, the
SHA-256 of the canonical JSON (sorted keys, no whitespace); the server
recomputes it and refuses a mismatch. The audit row stores only a **keyed**
digest of it,

```text
payload_digest = hex HMAC-SHA256(ROTA_IDENTITY_SECRET,
                   "petrios-rota-batch/v1|" + org_id + "|" + sha256)
```

(`rotaBatchDigest`), so a one-person batch (staff number + a few leave days)
cannot be brute-forced offline from a database copy or backup. Idempotency
compares this digest.

An uploader's submit also carries `proofs`, one per row, from that upload's
match preview (see Identity matching); a row without a valid proof refuses the
whole batch.

`validateRotaBatch` (`lib/rota/schema.ts`, zod `.strict()`) rejects the whole
batch on an unknown key, letter, or template id, reporting only an index and a
field name, never a value. Limits: at most 500 people, at most 98 days,
`from >= today − 14`, `to <= today + horizon_days`; `WORKED` requires
`to < today` and `PLANNED` requires `from >= today`; `days` has one character
per day; each person has at least one of `staff_key`, `email`, or `link`;
`link` is refused for an uploader. The body stays under the default 1 MB Server
Action limit and is never logged.

## Identity matching

`profiles` holds only email and names, so rota rows are matched through
`rota_identity_links`, which store a keyed hash and never the identifier:

```text
key_hmac = hex HMAC-SHA256(ROTA_IDENTITY_SECRET,
             "petrios-rota-id/v1|" + org_id + "|" + key_type + "|" + normalised)
```

`key_type` is `STAFF_ID` (ESR assignment or local staff number: trimmed,
upper-cased, optional suffix stripping) or `EMAIL` (trimmed, lower-cased). The
organisation id in the input separates tenants. Rotating the secret makes every
link unmatchable, so everyone must be re-linked.

Resolution order on the server (`resolveRotaPeople`), always restricted to
**current trainees of the department** (`department_members.role =
'trainee'`):

1. a moderator `link.user_id` (ignored unless the user is a current trainee);
2. a `STAFF_ID` link;
3. an `EMAIL` link;
4. an exact profile-email match.

If a row's staff key and email resolve to different users, the row is left
unmatched and counted as a conflict. If two rows resolve to the same user, both
are unmatched and counted. A moderator link with a staff key stores a
`STAFF_ID` link; otherwise one with an email stores an `EMAIL` link; a
confirmation by name alone stores nothing and must be repeated on every upload
(names never reach the server). The link's `origin` is decided on the server,
never taken from the browser: `EMAIL_MATCH` only when the row's email is exactly
the confirmed trainee's profile email, otherwise `MODERATOR`, so *Linked staff*
never shows "Exact email, confirmed" for a name-only confirmation. Unmatched
rows are dropped and only counted.

Before submitting, the wizard makes **one** `previewRotaMatches` call per
upload id with at most 500 `{ref, staffKey?, email?}` entries: **every row of
the file** that has a staff number or email, including people who are not
trainees (consultants, other staff groups). Each identifier is checked once
against the department's trainees and links, then discarded. A moderator gets
`{ref, userId, displayName, via}` per row; an uploader gets only
`{ref, matched, proof}`. Because the uploader's booleans are a membership
oracle, `record_rota_match_preview_v1` checks and records atomically, under a
per-caller advisory lock: one preview per (organisation, upload id)
(`duplicate`), and at most 10 previews per uploader in 24 hours
(`rate_limited`), so parallel previews cannot exceed the limit. Each call is
audited by count only.

The upload cannot widen the oracle: `ingest_rota_batch_v1` refuses a batch
unless the same caller recorded the upload's preview for the same department
(`rota:preview_required`), at most one `WORKED` and one `PLANNED` batch exist
per upload (`rota:batch_conflict`), and each uploader row must carry its
preview row proof

```text
proof = first 32 hex of HMAC-SHA256(ROTA_IDENTITY_SECRET,
          "petrios-rota-preview/v1|" + org_id + "|" + department_id + "|" +
          upload_id + "|" + caller_user_id + "|" + ref + "|" + staff_key + "|" + email)
```

(`rotaPreviewRowProof`, never stored), returned only for matched rows. A row
not in the preview, or with a changed identifier, refuses the whole batch, so
an upload can only carry identifiers whose match result the caller already
has. An uploader's result is limited to `replayed`, `peopleReceived`,
`matched`, `unmatched`, `conflicts`, `sessionsAnnotated`, and
`newUnmatchedSinceLast` (`details: null`); the flag, decision, rejection, and
link counts go to moderators only, because they would reveal what moderators
or trainees decided. Moderators match names client-side against the roster
returned only to them by `getRotaUploadContext`.

In the ingest transaction a link is accepted only for a current trainee of the
department. An existing link for the same hash pointing at a **different**
user is replaced only when that user is not a current trainee of another
enrolled department in the organisation; otherwise it is refused and counted
(`links_refused`), so one department cannot hijack another's link. The rule
lives in one helper, `rota_apply_identity_link`, shared with the moderator
link below.

The moderator-only *Linked staff* panel (`listRotaLinkedStaff`) lists current
trainees' links with name, key type, origin, and confirmation date, never the
hash; `revokeRotaLink` deletes one (also with the switch off). The next upload
then simply does not match that person. **Link a trainee by staff number**
(`linkRotaIdentity` → `link_rota_identity_v1`, under the per-org lock): the
moderator picks a current trainee and types the staff number (with the same
optional assignment-suffix rule as the upload profile) and/or the email the
rota uses; the server normalises and hashes them and stores `MODERATOR` links
with the same trainee and anti-hijack rules. This is how new starters are
linked after a changeover without the export ever being passed around.

## Server ingest

`submitRotaUpload` runs: guard → `validateRotaBatch` → hash check → the
upload's preview exists for this caller → (uploaders) every row's preview
proof → current trainees and link lookup → `resolveRotaPeople` → candidate
sessions → `computeRotaIngest` → size check → `ingest_rota_batch_v1` →
role-limited counts.

**Sessions in scope** (`listRotaCandidateSessions`): the department's
`PUBLISHED` sessions with policy v2, not `FINALIZED`, `date_end >= now − 14
days`, overlapping the batch's local range. Drafts get no flags (confirm
refuses them anyway), and the suggestions read returns nothing for a session
that is not `PUBLISHED`.

**Overlap rule** (`classifySessionOverlap`) for a session `[start, end)`:

- **unavailable** when `D`+`N`+`X`+`L` minutes ≥ min(30 minutes, 50% of the
  session);
- otherwise **available** when `A` covers at least 50%;
- otherwise **unknown**.

Unavailable people become `flags`; available people become `cleared`;
**unknown people are sent in neither list**, so an upload with a blank day (an
as-worked export listing only worked duties, a gap) never deletes a correct
flag. A trainee on an 08:30–17:00 day shift is therefore not flagged for an
08:00–09:00 session: the uncovered half hour is unknown, not unavailable, and
any existing flag stays. More than 100,000 flag and cleared pairs in one batch
is refused in the action with "This upload covers too many sessions at
once…".

`ingest_rota_batch_v1` (`SECURITY DEFINER`, service role only) runs in one
transaction:

1. takes `pg_advisory_xact_lock(hashtextextended('rota:' || org_id, 0))`, so
   concurrent ingests for one organisation serialise;
2. refuses with `rota:disabled` unless the organisation is enabled and the
   department enrolled;
3. validates the batch shape and a coarse date range, and caps the size per
   **session** (at most 500 rows per session, 100,000 in all, 500 links), not
   per day, so a large department is never refused for having many sessions
   (`rota:invalid_payload`);
4. requires the upload's preview by the same caller for the same department
   (`rota:preview_required`);
5. applies idempotency on `(org_id, batch id)`: the same digest, department,
   upload and kind return the stored counts with `replayed: true` and write
   nothing; anything else raises `rota:batch_conflict`, as does a second batch
   of the same kind for the upload. A batch id is scoped per organisation, so a
   reused id never returns or blocks another organisation's row;
6. inserts the batch audit row (counts, keyed digest, upload id, range, kind,
   profile, uploader);
7. upserts accepted links (rule above);
8. applies flags and 9. cleared rows by the precedence table below, rejecting
   (and counting in `rows_rejected`) any row for a non-trainee, another
   department's session, a policy-v1, draft, cancelled, or finalized session,
   or a session that ended more than 14 days ago;
10. records `sessions_annotated` (distinct sessions touched: **not** a count of
   unavailable people); and
11. runs the purge for the organisation.

| Existing flag | Incoming | Result |
|---|---|---|
| none | unavailable | insert `OPEN` |
| `OPEN` | unavailable, unless the existing flag is `WORKED` and the batch is `PLANNED` | replace kind, `as_of`, batch, and session snapshot |
| `OPEN` `WORKED` | anything from a `PLANNED` batch | ignored (planned never overwrites as-worked) |
| `OPEN` | available (cleared), same precedence | deleted |
| any | unknown | untouched (never sent) |
| `CONFIRMED`/`DISMISSED`/`CONTESTED` | available (cleared), same precedence | not rewritten; `rota_changed_at` set |
| `CONFIRMED`/`DISMISSED`/`CONTESTED` | unavailable again, snapshot matches | `rota_changed_at` cleared |
| decided, snapshot no longer matches the session | unavailable | old row deleted, fresh `OPEN` inserted (the session moved) |

## Session flags

`rota_session_flags` is the only per-person rota data: one row per session and
trainee, only for unavailable trainees. It records kind (`PLANNED`/`WORKED`),
`as_of`, the batch id, a snapshot of the session's `date_start`/`date_end`,
state (`OPEN`, `CONFIRMED`, `DISMISSED`, `CONTESTED`), who decided and when,
`contested_at`, `rota_changed_at`, and `expires_at` (session end + 90 days). No
category column exists.

Every read goes through the security-invoker view `rota_visible_session_flags`,
which applies the read rule in one place: not expired, organisation enabled,
department enrolled, the user still a current trainee of the department, the
session's current times equal to the snapshot, and the session not cancelled.
A flag whose session moved, or whose user left, is invisible even before any
hook or purge deletes it. Reads, confirm, and purge all ignore or delete a flag
whose snapshot does not match.

Flags for future sessions exist from upload time. Moderators cannot see them
before the session starts; the trainee can always see their own.

## Attendance suggestions (moderator)

`getRotaSuggestionsForSession` returns nothing unless rota is available for the
session's organisation and department, the caller passes
`requireRotaModerator`, the session is policy v2 and not `FINALIZED`, and the
session has started. The *Expected roster* panel sits above the attendance
management panel on the manage page's Attendance tab.

It lists the department's current trainees who have **no valid presence
evidence** (`SELF_CHECKIN`, `GROUP_CODE`, `TEAMS`, or a `TEACHER` row that is
not an assigned-teacher row). A trainee with Recall catch-up (`RECALL`)
evidence is **not listed**: after a reopen, a new excusal would be the latest
moderator decision, outrank the catch-up and could not be redone (the catch-up
returns the existing completion), so the completed catch-up counts as the
decision; `confirm_rota_excusal_v1` refuses it as `rota:caught_up`. A
confirmed rota excusal stays listed even after presence evidence arrives,
with the `Attendance evidence received after excusal` marker, so the moderator
can correct it. Row states:

| State | When | Actions |
|---|---|---|
| `SUGGESTED` | An `OPEN` flag and no moderator decision | Confirm (only after `date_end`), Dismiss (from `date_start`) |
| `CONFIRMED` | The flag was confirmed (the rota excusal is the latest moderator decision) | — |
| `DISMISSED` | The flag was dismissed | — |
| `CONTESTED` | The trainee said the rota was wrong | None: the suggestion is hidden and the moderator decides manually |
| `DECIDED_MANUALLY` | A moderator decision other than the rota excusal exists | — |
| `NONE` | No flag | — |

State precedence (`buildRotaSuggestionRows`, `lib/rota/suggestions.ts`):
catch-up evidence hides the row; a `CONFIRMED` flag is `CONFIRMED` while the
rota excusal is the latest moderator decision (ordered exactly like the SQL:
`observed_at`, then `created_at`, then id, through `compareChronological` in
`lib/attendance/compute.ts`) and `DECIDED_MANUALLY` once a later decision
exists; otherwise valid
presence evidence hides the row; then `CONTESTED`, any moderator decision
(`DECIDED_MANUALLY`), `DISMISSED`, `SUGGESTED`, `NONE`. Only `SUGGESTED`,
`CONFIRMED`, and `DISMISSED` rows show the rota as-of time and kind; they are
blank for `CONTESTED` and `DECIDED_MANUALLY`. Confirm and Dismiss are offered
only on a `SUGGESTED` row of a policy-v2 session that is not finalized.

Markers: `Contested by trainee` (on `CONTESTED` rows) · `Rota changed since
you confirmed` (only on `CONFIRMED` rows: a newer batch no longer shows the
person unavailable) · `Attendance evidence received after excusal` (only on
`CONFIRMED` rows). Before `date_end` Confirm is disabled and each suggested
row shows the visible hint `Confirm opens after the session ends.` (linked to
the button with `aria-describedby`), because a confirmed excusal outranks every
live source. Confirm and Dismiss carry `aria-label`s naming the trainee.

When no as-worked batch reaches the session's day yet (none exists, or the
newest one's `range_to` is before `appDayKey(date_start)`; an as-worked batch
only ever covers days before its upload day), an informational note reads
`Suggestions for this session come from the planned rota. The next weekly
as-worked upload may change them; you do not need to wait for it to
finalize.` After the session, when suggestions are still undecided, the panel
says `N suggestion(s) still undecided. Finalizing records undecided trainees
as absent.`, and the finalize confirmation of the Attendance Governance panel
starts with `N rota suggestion(s) undecided and will be recorded as absent.
Finalize anyway?` (`undecidedRotaSuggestions`, counted from the rows in the
browser). This is a UI hint only: finalizing never reads rota data.

A suggestion row reads:

```text
Suggested: excused (rostered unavailable) · rota as of Wed 14 Oct 06:00 (as worked)
```

with `(planned)` for a planned batch. `buildRotaSuggestionRows` returns the raw
ISO time and the action formats it on the server with `formatInAppTimeZone`
(`APP_TIME_ZONE`, weekday + day + month and a 24-hour time), never in the
browser.

### Confirm

`confirmRotaSuggestion(sessionId, userId)` calls
`confirm_rota_excusal_v1(org, session, user, actor)`, never the generic
`addEvidence` (which uses a random event key and could not stop a double click
writing two rows). In one transaction the RPC:

0. requires 064's marker to include `EXCUSED` (missing marker = 42883 = not
   installed; a marker without it = `rota:disabled`), so an excusal never
   removes a trainee's catch-up route;
1. locks the session row (`rota:not_found` if absent in the organisation);
2. requires rota enabled and the department enrolled (`rota:disabled`);
3. requires policy v2, `PUBLISHED`, not `FINALIZED`, not locked, and
   `date_end <= now()` (`rota:not_confirmable`);
4. requires the user to be a current trainee (`rota:not_eligible`);
5. moves the flag `OPEN` → `CONFIRMED` with a conditional update that also
   requires `expires_at > now()` and a matching snapshot
   (`rota:suggestion_changed` when no row moves);
6. refuses when valid presence evidence exists (`rota:presence_evidence`),
   catch-up (`RECALL`) evidence exists (`rota:caught_up`), or a
   `MODERATOR_CONFIRMATION` already exists (`rota:already_decided`), rolling
   back step 5;
7. calls `record_attendance_evidence_v2` with source
   `MODERATOR_CONFIRMATION`, reason `Rostered unavailable (rota)`, the
   deterministic key `ROTA_EXCUSAL:<session>:<user>:<attendance_revision>`, and
   metadata:

   ```json
   { "status_override": "EXCUSED", "reason_code": "ROTA_UNAVAILABLE",
     "rota_batch_id": "<uuid>", "rota_kind": "WORKED", "rota_as_of": "<timestamp>",
     "actor_user_id": "<uuid>" }
   ```

8. appends the session activity event `ROTA_EXCUSAL_CONFIRMED` with the batch id
   and kind.

Two concurrent confirms serialise on the session lock; the second finds no
`OPEN` row and gets `rota:suggestion_changed`, so exactly one
`MODERATOR_CONFIRMATION` is written. The flag and the evidence row stay
separate records: the suggestion is logged apart from the decision.

### Dismiss

`dismissRotaSuggestion` calls `dismiss_rota_suggestion_v1`: one transaction
moves an `OPEN` flag whose snapshot still matches the session (and
`expires_at > now()`) to `DISMISSED` and appends the session activity event
`ROTA_SUGGESTION_DISMISSED` (actor, subject, batch id and kind; no category),
which outlives the flag's purge. The action allows it on a `PUBLISHED`
policy-v2 session from `date_start` until attendance is finalized (otherwise
`dismiss_not_open`). It writes no evidence. The panel asks first: "Dismiss
the rota suggestion for NAME? This cannot be undone: …recorded as absent at
finalization."

The two read actions (`getRotaSuggestionsForSession`, `getMyRotaFlag`) return
`null` on any failure, so the optional panels can never break the manage or
session page. The moderator and trainee mutations return `{ ok: false,
message }` for every failure, unexpected ones included, and never throw.

### Finalization

Unchanged (spec 03). Rows with no decision become `ABSENT`. A dismissed or
unconfirmed suggestion has no effect on the result. The undecided-suggestions
warning above is the only rota touch on the finalize screen, and it lives in
the browser.

## Trainee notice and contest

`getMyRotaFlag(sessionId)` returns only the caller's own visible flag, with
`beforeSession`. The session page's note follows the flag's state:

| State | Note |
|---|---|
| `OPEN`, before the session | Your department's rota shows you as unavailable for this session. If you can attend, please do. After the session your moderator decides how the rota is used. **[This is wrong]** |
| `OPEN`, after the start | Your department's rota showed you as unavailable for this session. Your moderator decides how this is used. **[This is wrong]** |
| `CONFIRMED` | Your moderator recorded you as excused (rostered unavailable) for this session. |
| `DISMISSED` | Your department's rota showed you as unavailable for this session. Your moderator did not use the rota for this session. |
| `CONTESTED` | You told us the rota was wrong. Your moderator will decide manually. |

Every state adds the rota's as-of time and `Missed teaching can still be
exception-reported to your educational supervisor.` (under the 2016 terms and
conditions, educational exception reports go to the educational supervisor).

**This is wrong** asks for confirmation first, because it is final: "…This
cannot be undone. The rota will then not be used for you: your moderator
decides your attendance without it, and with no check-in or decision you are
recorded as absent. If you could not attend because of your rota, do not use
this." `contestMyRotaFlag` calls `contest_rota_flag_v1`: one transaction moves
the caller's own `OPEN` flag (snapshot matching) to `CONTESTED` and appends
the session activity event `ROTA_FLAG_CONTESTED` (actor and subject the
trainee; no category). The moderator's row then shows `Contested by trainee`
with no Confirm button.

## Recall catch-up for excused trainees (migration 064)

Owner decision O2: a finalized `EXCUSED` expected attendee who completes the
Audio Recap catch-up becomes transparent catch-up `PRESENT`, exactly like the
`ABSENT` path. Migration 064:

- widens `complete_recall_catchup_v2` to a current finalized `ABSENT` **or**
  `EXCUSED` row; the expected-attendee, registered-user, and accepted-teacher
  exclusions are unchanged, and there is no branch on the reason code;
- adds `recall_catchup_eligible_statuses_v1()` returning `{ABSENT,EXCUSED}`.
  The application (`listCatchupEligibleStatusesAsSystem`) reads it for the
  `recall-send` audience, the token-page eligibility check, and answer
  submission. Before 064 is applied the function is missing and the app falls
  back to `['ABSENT']`, so nothing changes;
- rewrites the primary-evidence selection in `record_attendance_evidence_v2`
  (the latest moderator decision wins, and RECALL after an `ABSENT`/`EXCUSED`
  override wins; spec 03 "Evidence sources and derivation"). The application's
  policy-v1 recomputation (`computeAttendanceFromEvidence`) reads the same
  marker and keeps the pre-064 earliest-first rule until it exists, so the
  TypeScript and SQL rules agree whichever is deployed first;
- re-opens `sent_catchup_at` on approved question sets whose catch-up window
  is still open, so the `recall-send` cron invites the newly eligible
  `EXCUSED` expected attendees of packages sent before 064. The per-recipient
  `RECALL_CATCHUP_INVITE` delivery ledger skips everyone already invited;
  closed windows are left alone.

The widening is independent of the rota kill switch: it applies to every
finalized excused expected attendee once 064 is applied. Recall never reads rota
data. The catch-up invitation never mentions the rota.

## Hooks

- **Session time change or cancellation.** After a successful `updateSession`,
  `onSessionScheduleChanged` deletes the session's flags when `date_start` or
  `date_end` changed or the status became `CANCELLED`. The next upload
  recomputes them. A confirmed excusal's evidence row stays; the moderator can
  correct it through the ordinary reopen/correction flow.
- **Department member removal.** `removeDepartmentMember` and `leaveDepartment`
  call `onDepartmentMemberRemoved`, which deletes the user's flags for that
  department.
- **Session deletion** cascades through the foreign key.

Hooks run only while the kill switch is on, swallow `RotaNotInstalledError`,
and log other failures without ids. The snapshot rule and the read view cover
any gap (for example edits made while the switch was off).

## Retention and purge

| Data | Kept until |
|---|---|
| Session flag | `retention_days` (default 30, 1–90) after the later of attendance finalization and the close of the session's approved Recall question set; hard cap `expires_at = session end + 90 days`. Deleted earlier when the session is cancelled or moved, the user stops being a trainee of the department, the department is un-enrolled, the organisation is disabled, or the account is deleted |
| Identity link | Until the user is no longer a current trainee in any enrolled department of an enabled organisation, a moderator revokes it, the organisation disables rota, or the account is deleted. Rotating `ROTA_IDENTITY_SECRET` makes links unmatchable |
| Uploader grant | Until revoked or the user is no longer an organisation member |
| Batch audit (counts, keyed digest, upload id, range, kind, uploader) | 12 months |
| Match-preview audit (counts only) | 12 months |
| `ROTA_EXCUSAL_CONFIRMED`, `ROTA_SUGGESTION_DISMISSED`, `ROTA_FLAG_CONTESTED` session activity events (batch id and kind; no category) | Normal session activity retention: the lasting record of each decision once the flag is purged |
| Mapping profile, settings, enrolment | Until deleted; no person data |
| `MODERATOR_CONFIRMATION` evidence (`ROTA_UNAVAILABLE`) | Normal attendance retention: it is a lasting part of the attendance record |
| Raw file, shift codes, names, leave reasons, per-day grid | Never stored |

`purge_rota_data_v1(org | NULL)` is deletion-only. It runs:

- at the end of every ingest, for that organisation; and
- awaited on every run of the hourly `post-session-reports` cron (all
  organisations), including its early "no sessions" return. Failures are
  caught and logged as `[rota] purge failed` without details and never fail
  the cron. The JSON response carries `rota_purged`: the per-rule deletion
  counts, or `null` before 063 is applied or after a failure.

There is no new cron trigger. Apart from the org admin's and moderator's
deletion-only cleanup actions (and the Settings read that offers them), the
purge is the only rota database call that runs while the kill switch is off, so
the retention promise holds if the switch is turned off with data present.
Identity links have no time-based expiry while the organisation stays enabled,
which is why Disable works with the switch off. Before 063 is applied the purge
is a silent no-op.
Expired flags are invisible through the read view before the purge removes
them.

## What Petrios stores, receives briefly, and never receives

| Stored | Received in the request, used, then discarded | Never received |
|---|---|---|
| Per session, only for unavailable trainees: the "rostered unavailable" flag, `as_of`, planned/worked, decision state, who decided and when, contest time | The per-person day-status grid (letters A/D/N/X/L) for up to 98 days. Runs of `L` and patterns of `X` are visible to the server for the length of the request | The raw export; shift codes; leave reason or type; sickness or occupational-health data; ward, grade, pay codes, hours, LTFT status, notes |
| Keyed-hash identity links | Staff numbers and emails, in clear, only to compute the HMAC; at the match check, those of **every row** in the file (non-trainees included), checked once and discarded | Names (moderator name matching happens in the browser) |
| Batch and preview audit: counts, keyed digest, upload id, range, uploader | | The number of unavailable people per batch |
| The moderator's `MODERATOR_CONFIRMATION` evidence row with `reason_code: ROTA_UNAVAILABLE` | | |

Request bodies are not logged. RPC errors use fixed `rota:<code>` messages with
no ids or values, so a Postgres error line never contains an export identifier.
There are no rota analytics, trend views, history views, or performance uses.

## Error codes

| `rota:` code | Message shown |
|---|---|
| `disabled` | "Rota availability is not enabled for this department." |
| `invalid_payload` | "The upload could not be read. Reload the page and try again." |
| `batch_conflict` | "This upload was already sent with different content. Reload the page to start a new upload." |
| `not_found` | "Session not found." |
| `not_confirmable` | "Suggestions can be confirmed only after the session has ended and before attendance is finalized." |
| `not_eligible` | "This person is no longer a trainee in this department." |
| `suggestion_changed` | "This suggestion has changed or was already decided. Refresh to see the latest state." |
| `presence_evidence` | "This trainee has attendance evidence, so the suggestion no longer applies." |
| `already_decided` | "A moderator decision already exists for this trainee." |
| `caught_up` | "This trainee completed the catch-up, so the suggestion no longer applies." |
| `preview_required` | "Check matches for this upload first. Reload the page to start a new upload." |
| `rate_limited` (action only) | "The daily limit for match checks is reached. Try again tomorrow." |
| `duplicate_preview` (action only) | "Matches for this upload were already checked. Reload the page to start a new upload." |
| `too_large` (action only) | "This upload covers too many sessions at once. Export a shorter date range and upload it in two parts." |
| `trainee_uploader` (action only) | "A trainee of this department cannot upload its rota. Choose a rota coordinator who is not a trainee here." |
| `link_refused` (action only) | "Not linked: that staff number or email is already linked to a trainee of another department." |
| not installed / unavailable | "Rota availability is not available." |
| forbidden | "You do not have access to rota availability for this department." |
| `dismiss_not_open` (action only) | "Suggestions can be dismissed only after the session has started and before attendance is finalized." |
| `unexpected` (action only) | "Something went wrong. Refresh the page and try again." (the server logs only a fixed `[rota] <label> failed` line) |

Every rota Server Action returns `{ ok: false, message, code? }` for these and
never throws them.

## Storage summary

All 063 tables enable RLS with **no policies** and revoke all privileges from
`PUBLIC`, `anon`, and `authenticated`; only `service_role` has grants. All
functions are `SECURITY DEFINER SET search_path = public` (the two internal
helpers, `rota_is_department_trainee` and `rota_apply_identity_link`, are
`SECURITY INVOKER`), revoked from `PUBLIC`, `anon`, and `authenticated`, and
granted to `service_role`. The RPCs are `purge_rota_data_v1`,
`record_rota_match_preview_v1`, `ingest_rota_batch_v1`,
`link_rota_identity_v1`, `confirm_rota_excusal_v1`,
`dismiss_rota_suggestion_v1`, `contest_rota_flag_v1`, and
`disable_rota_for_org_v1`. The DAL is `lib/db/rota.ts` (`getServiceDb()`, each
function justified as "deny-all table (063); caller authorized via
lib/rota/access.ts"). Spec 02 lists the tables.

## Current limitations

- **Upload freshness.** Suggestions are only as fresh as the last upload. A
  session created between uploads has no flags until the next one. The
  as-worked banner is the reminder; there is no automation in Phase 1.
- **Wall-clock post-night rest** is off by ±1 hour across a clock change.
- **Membership oracle.** The uploader's booleans reveal whether an identifier
  belongs to a trainee of the department. It is limited (one call per upload,
  500 people, 10 per day, enforced atomically), the upload itself can carry
  only rows from that preview, and it is audited by counts; it remains a
  residual DPIA risk.
- **Coordinator accounts.** Joining an organisation also makes someone a
  department member, and finalization snapshots every department member as an
  expected attendee (spec 03). A coordinator should therefore join a separate
  non-teaching department (for example "Medical staffing") rather than the
  teaching department, or they will be recorded absent and invited to
  catch-ups (docs/rota.md §2).
- **Rotation churn.** New ESR assignment numbers at changeover produce a wave of
  unmatched rows. The summary shows "new unmatched since last upload".
- **Name-only exports** need moderator confirmation on every upload.
- **Inference over time.** A run of confirmed "rostered unavailable" excusals
  can still suggest extended absence to a moderator, as excused attendance
  already can. This is recorded as a residual risk; Petrios offers no view that
  aggregates it.

## Verification contract

Changes to this subsystem require:

- the pure tests in `lib/rota/*.test.ts` (CSV, mapping, dictionary, post-night,
  expansion across DST, overlap edges, schema rejection without values,
  WORKED/PLANNED split with no extra keys in the serialized payload, canonical
  hash, HMAC vectors and tenant separation, matching order and conflicts,
  ingest classification, the super-admin refusal in `authz.test.ts`, and the
  exact-`"true"` kill switch);
- the static migration checks in `lib/db/rota-migration.test.ts` (no
  `CREATE POLICY`, RLS and revokes on every object, `SET search_path` on every
  `SECURITY DEFINER`, exact 045/059 signatures in 064);
- the lab checks `scripts/rota/run-lab-checks.sh` (grant matrix, governance
  check, cross-org enrolment, idempotency, upload-preview binding and the
  per-session size cap (L4b), precedence table, draft refusal, anti-hijack and
  the moderator link (L5h), ingest and confirm concurrency, the catch-up
  refusal (L7j), dismiss/contest events (L7k), the atomic preview limit (L14),
  purge rules, disable, primary-selection parity P1–P9, Recall widening, view
  visibility), run only against a local lab database; and
- the compute parity cases in `lib/attendance/compute.test.ts`, kept identical
  to the SQL cases.

## RFC: later phases (not implemented)

- **Phase 2, scheduling counts.** Per department and rota scope, 30-minute
  blocks of "known" and "free" counts, banded and rounded to 5, never below a
  cohort of 5, with no names. It needs its own migration (free blocks and scope
  membership) and a replacement ingest RPC.
- **Phase 3, push API.** `POST /api/v1/rota/batches` taking the same minimised
  payload as signed NDJSON with a `write:rota` token scope, so a trust can
  automate the weekly export from inside its own network. No route, scope, or
  signing secret exists today.
