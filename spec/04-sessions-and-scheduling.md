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
| `JITSI` | Petrios Meet video room | Derived room `Petrios-<session UUID>`; embedded with JaaS or self-hosted Jitsi, opened in a new tab on meet.jit.si (see Petrios Meet) |

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

**Rota flags follow the session's times.** Where rota availability is enabled
(spec 14), a session can carry per-trainee "rostered unavailable" flags computed
for its exact start and end. After a successful `updateSession`, the action
awaits `onSessionScheduleChanged` (`lib/rota/session-hooks.ts`): when
`date_start` or `date_end` changed, or the status became `CANCELLED`, it deletes
that session's flags, and the next rota upload recomputes them. The hook runs
only while `ROTA_INTEGRATION_ENABLED` is exactly `"true"`, swallows a
not-yet-applied migration, and never fails the edit. Independently, every flag
snapshots the session times it was computed for, and reads, confirmation, and
the purge ignore or delete a flag whose snapshot no longer matches, so an edit
made while the switch was off cannot surface stale flags. A moderator's
already-confirmed rota excusal is attendance evidence and is not removed by a
time change; it is corrected through the ordinary reopen/correction flow
(spec 03). Deleting a session cascades to its flags.

The interactive start-time picker offers quarter-hour values from 08:00 through
17:30. A stored off-range or off-grid time remains available when editing so an
unrelated edit never silently shifts it. Browser-entered wall times are
converted to instants in the browser, and the primary session lists format those
instants in the viewing browser as well; this avoids a deployment server's UTC
timezone shifting a British Summer Time listing by one hour.

Everything the server renders — emails (invitations, reminders, notifications),
certificate/audit/portfolio PDFs, server pages, cron output and Ops drafts — is
formatted with `lib/datetime.ts` in `APP_TIME_ZONE` (an IANA name, default
`Europe/London`; an invalid value falls back to the default with a logged
error). Server clocks are UTC on both runtimes and Workers ignore `TZ`, so
nothing relies on the process time zone. The ICS feed keeps UTC (`Z`)
timestamps. Client components keep the viewer's zone and use
`components/LocalSessionDateTime.tsx` for any timestamp rendered during SSR
(spec 07).

New interactive sessions offer 30–240 minutes in 30-minute steps plus **Full
day**, defined as 570 minutes (08:00–17:30). The creation action enforces that
vocabulary. The general update action continues to enforce valid dates and
`end > start`, rather than rejecting historical exact/off-grid durations.
Editing preserves an existing off-grid duration and also offers Full day.
Teaching slots retain their separate duration rules below.

### Department session lists

The department sessions page (`/departments/[id]/sessions`) lists only sessions
that have not yet ended (`date_end > now` at request time, ascending by start),
so a session in progress stays on the main list. A separate previous-sessions
page (`/departments/[id]/sessions/past`), linked from the main page header,
lists sessions with `date_end <= now`, most recent start first. This is the same
edge and inclusivity as the publish rule above. Both predicates are applied in
the DAL query (`listSessionsByOrg` with `ended: true | false`) rather than in
memory; the dashboard calendar and the schedule page continue to load the
unfiltered set. Any member who can open the department list can open the
previous list; Manage and Delete remain moderator-only on both. Creating or
deleting a session revalidates both list paths. Session creation has no
past-date guard, so a back-dated session lands directly on the previous list;
the post-creation banner points there.

## Repeating session creation

Interactive creation can materialize up to 52 draft sessions in one operation:

- weekly;
- every two weeks; or
- monthly on the same ordinal weekday as the first date, such as the third
  Friday.

Monthly fifth-weekday patterns skip months without that fifth weekday. The
browser derives each local wall-clock start before converting it to an instant,
so a 09:00 series remains at 09:00 across daylight-saving changes. The server
validates every distinct start and duration, and the DAL inserts the whole set
with one Postgres statement; a failed row does not leave a partial series.

The resulting rows are deliberately ordinary, independent `DRAFT` sessions.
There is no persisted recurrence rule or series-wide update/cancel operation;
each materialized session is edited, published, or cancelled independently.

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
`session.published` webhook, registered with `after()` so it runs after the
response (spec 09). The action updates the session first and does not roll it
back if delivery fails. Moving back to draft does not revoke emails,
calendar entries already cached by clients, certificates, feedback, or related
records.

Publication makes the session eligible for reminder, feedback, calendar, Recall,
Ops, and reporting selectors, subject to each selector's time and watermark
rules. It does not automatically invite teachers or recipients.

## Petrios Meet

`JITSI` sessions get a video room derived from the session id: the room is
`Petrios-<session UUID>` (never stored, so every `JITSI` session has a room with
zero setup). A UUID-derived room is hard to guess but is not an access control
on its own; access control comes from room passes in the token modes below.

### Meeting modes

`lib/meeting/config.ts` (`resolveMeetingConfig`/`getMeetingConfig`) is the one
place that decides the backend. It reads server environment at request time
(never a browser bundle), trims every value, treats an empty value as unset, and
returns no secret. Client components never import it.

| Mode | Selected by | Behaviour |
|---|---|---|
| `jaas` | `JAAS_APP_ID`, `JAAS_API_KEY_ID` and `JAAS_PRIVATE_KEY` all set (with `JITSI_DOMAIN` unset, `meet.jit.si` or `8x8.vc`) | 8x8 Jitsi as a Service on `8x8.vc`, embedded; the room is `<AppID>/Petrios-<UUID>`; every participant joins with an RS256 room pass whose header `kid` is `JAAS_API_KEY_ID` |
| `self-hosted` | `JITSI_DOMAIN` (alias `NEXT_PUBLIC_JITSI_DOMAIN`) names another host, optionally with a port | The operator's Jitsi, embedded. With `JITSI_APP_ID` + `JITSI_APP_SECRET`, every participant joins with an HS256 Prosody token-auth pass (`iss` = app id, `aud` = `JITSI_JWT_AUDIENCE` or `jitsi`, `sub` = `JITSI_JWT_SUBJECT` or the domain host); without them the room is open |
| `public` | Nothing set, or `JITSI_DOMAIN=meet.jit.si` | The free meet.jit.si service. **Never embedded**: since 2023 meet.jit.si disconnects embedded (iframe API) calls after 5 minutes and requires the person who starts a room to sign in. The panel links out in a new tab |

Anything partial or contradictory is a configuration error and makes meetings
**unavailable** (no silent fallback to meet.jit.si, no embedding, no meeting
origin in the CSP): one or two of the three `JAAS_*` variables; JaaS plus a
different `JITSI_DOMAIN` or any `JITSI_APP_*`/`JITSI_JWT_*` variable; a malformed
AppID, key id (it must start with `<AppID>/`), or private key (it must be an RSA
PEM, PKCS#8 `BEGIN PRIVATE KEY` or PKCS#1 `BEGIN RSA PRIVATE KEY`; literal `\n`
escapes, CRLF and surrounding quotes are accepted); `8x8.vc` without JaaS; a
`JITSI_DOMAIN` with a scheme, path or invalid port; exactly one of
`JITSI_APP_ID`/`JITSI_APP_SECRET`; audience/subject overrides without both; or
token variables with meet.jit.si. The private key's DER structure is checked
when the configuration resolves (an EC, encrypted, truncated or corrupted key is
a configuration error, not a failure at first join); a key that passes that
check but still fails WebCrypto import makes the join `unavailable`.
`meet.jit.si` with any port still counts as public. The error message names variables and may
include the non-secret domain, never a key or secret. `getMeetingConfig` logs
it once per distinct environment the first time anything resolves it (the proxy
does so on the first request, so a bad deployment is visible in the logs before
anyone clicks Join); joins do not repeat it. It is shown on the moderator-only
manage card and on the super-admin installation page
(`/settings/installation`, "Video (Petrios Meet)", via
`lib/meeting/status.ts`); members see a generic "Video rooms are unavailable
right now" message.

### Room window and room passes

The room is open from 30 minutes before `date_start` through 30 minutes after
`date_end`, inclusive, on the **server** clock (`lib/meeting/window.ts`). The
panel receives the server time and corrects for client clock skew; the server
re-checks the window on every pass request.

Room passes (`app/actions/meetings.ts`, claims in `lib/meeting/claims.ts`,
WebCrypto signing in `lib/meeting/jwt.ts`, so the same code runs on Node and
Workers):

- `getMeetingJoin(sessionId)` requires a signed-in user and reads the session
  with the RLS-honouring `findSession(id, currentOrgId)`, so only users who may
  read the session get a pass. `getExternalTeacherMeetingJoin(sessionId, code)`
  requires an `ACCEPTED` invitation matched on both invite code and session id,
  then reads the session with the service-role
  `findSessionForInvitationAsSystem` pinned to the invitation's organization.
  It mints nothing (non-retryable `unavailable`, one operator warning per
  process, no database lookup) unless `TEACHER_INVITATIONS_RLS_LOCKED` is
  exactly `true` (`lib/teacher-invitation-capability.ts`): migration 017's
  public `teacher_invitations` policies make every invite code world-readable
  and every row world-writable, so a code is a capability only after they are
  dropped (spec/13 "External teacher invite codes").
- Both require `location_type = 'JITSI'`, status `PUBLISHED` (draft and
  cancelled rooms are closed) and the room window. Denials are returned, never
  thrown: `not_signed_in`, `not_found`, `invalid_invitation`, `not_accepted`,
  `not_video`, `not_published`, `cancelled`, `too_early` (with the open time,
  retryable), `ended`, `not_embedded` (public mode), and `unavailable`
  (configuration or signing error, retryable). Unexpected failures are logged
  without token, key, or email and returned as `unavailable`.
- A pass is restricted to that one room (`room` claim = the lower-cased
  `petrios-<uuid>`, without the JaaS AppID), `nbf` = now − 30 s, and
  `exp` = min(now + 4 h, room close). Every Join or Rejoin mints a fresh pass;
  passes are never cached, so a participant who stays past `exp` and reconnects
  rejoins with a new one. No pass is minted when `exp` would not be after
  `iat` in whole seconds (a request exactly at the room close answers `ended`,
  not a logged `unavailable`). The 4-hour ceiling, rather than a connect-time
  lifetime, is deliberate: Jitsi re-authenticates with the same pass on a full
  in-call reconnect, which the iframe cannot refresh (spec/13 explains the
  trade-off).
- Moderator = department moderator (`isDepartmentModerator`, which includes org
  admins and super admins in the current organization) or an `ACCEPTED`
  registered teacher of the session; an accepted external teacher always
  moderates; everyone else is a participant. JaaS and the claims use the strings
  `"true"`/`"false"`. JaaS enforces the flag; a self-hosted server does only
  with guest access off, Jicofo auto-owner off and a Prosody module that applies
  the claim (docs/self-hosting.md), and the manage card and installation page
  say so.
- Data minimisation: the pass carries only a display name (`meetingDisplayName`
  from the profile; "Attendee" fallback; an external teacher's invitation name
  with a "Guest teacher" fallback), a per-session pseudonymous id
  (`SHA-256("petrios-meet:" + sessionId + ":" + subject)`, 32 hex), and the
  moderator flag. Never an email address or avatar.
- Features: recording, live streaming, transcription, inbound/outbound and SIP
  calls, and file upload are `"false"` in every pass. JaaS enforces these; a
  self-hosted server enforces them only if its configuration does.

An open self-hosted room needs no pass: the action returns the room with
`jwt: null`, and the room itself stays open outside the Petrios window.

### Join surfaces

- **Session page** (`/sessions/[id]`, members): `JitsiMeetingPanel` shows the
  room for every `JITSI` session. States: opens-at (local time), Join, getting a
  room pass, loading, in the room, left/Rejoin, ended, not published/cancelled,
  unavailable, room-pass error with Retry, and a load failure with Reload.
  Embedded rooms use `MeetingEmbed` (`@jitsi/react-sdk` `JitsiMeeting` loaded
  client-only with `domain`, `roomName` and `jwt`; configuration from
  `lib/meeting/embed-config.ts`: prejoin on, audio muted at start, deep linking,
  invite functions and third-party requests (e.g. gravatar) off, the display
  name locked to the room pass in token modes, and the session title as
  subject; plus an iframe `title` and a responsive `min(75vh, 680px)` height). In public mode the
  panel shows an "Open video room" link (`<a target="_blank" rel="noopener
  noreferrer">`, so no popup blocker and no referrer) to
  `https://meet.jit.si/Petrios-<uuid>` and explains that the first person to
  arrive (usually the teacher) signs in to Jitsi to start the room. Joining
  attempts self check-in (spec 03) and announces the outcome; the room's hosts
  (`viewerIsModerator` on the view, the pass's moderator flag when embedded)
  are not checked in and see "You're hosting this room". A member who joined
  before check-in opened is checked in automatically once, when it opens
  (`checkInRetryDelay`, skew-corrected, up to 5 s jitter), while still in the
  room or on the page after opening the meet.jit.si tab; a failed check-in
  offers "Try check-in again". A member whose profile has no name sees that the
  room will show "Attendee" (locked in token modes) and is asked to have their
  organiser add it. Embedded-room behaviour (event wiring in
  `lib/meeting/embed-events.ts`, unit-tested): a "Leave video room" button sits
  outside the iframe; `readyToClose` closes the room at once while
  `videoConferenceLeft` closes it only if no rejoin follows within 4 s (Jitsi
  emits it during an in-room reconnect); only `errorOccurred` with
  `isFatal === true` counts; a 30 s script-load watchdog and an SDK error
  boundary lead to "Reload page". A fatal error after entering the room offers
  "Rejoin video room", which mints a fresh pass ("Your room pass expired"
  wording after expiry); a fatal error BEFORE entering (typically a refused
  pass: wrong JaaS public key or key id, or self-hosted claim/secret mismatch)
  says the video service did not accept the connection, offers "Try again", and
  reports the provider error name to the server (`reportMeetingConnectError`,
  identifier-only, embedded modes only) so it reaches the operator's logs.
  Every mount gets a new React key and the External API is disposed on
  unmount; focus moves into the room on mount and back to the next action on
  close. A signed-out member is offered `/login?next=/sessions/<id>`; the proxy
  and the session page also redirect signed-out visitors to
  `/login?next=<requested path>` (`loginUrlFor`, same-origin only, `_rsc`
  dropped), so an emailed or calendar room link survives sign-in.
- **External teacher RSVP page** (`/sessions/[id]/teacher-rsvp/[code]`): with
  `TEACHER_INVITATIONS_RLS_LOCKED=true` it reads the session through
  `findSessionForInvitationAsSystem` after matching code and session id
  (anonymous visitors cannot read `sessions` through RLS); otherwise it uses the
  RLS read, so signed-out visitors see the RSVP form (always shown for a
  PENDING invitation) without session details. An `ACCEPTED` invitation for a
  `JITSI` session shows "Your teaching room": the embedded room with a moderator
  pass in token and open self-hosted modes (token modes only with the flag on;
  otherwise a notice to contact the organiser), the meet.jit.si link in public
  mode. The page asks the teacher to keep its link. External teachers get no
  check-in.
- **Calendar** (`SessionCalendar`, client): Petrios Meet sessions route to the
  session page; Teams links come from `storedMeetingUrl` in the client-safe
  `lib/meeting/location.ts`.

Guests without a Petrios account or an accepted teacher invitation cannot join a
token-protected room. Invite them as external teachers instead.

### Meeting URL contract

All outbound surfaces use `sessionMeetingUrl(session, audience, config?)` in the
server-only `lib/jitsi.ts`, where `audience` is `{ kind: 'member' }` or
`{ kind: 'external_teacher', inviteCode }`:

| Location | Mode | Member | External teacher |
|---|---|---|---|
| `MS_TEAMS` / `HYBRID` | any | Stored Teams link (may be null) | Same |
| `IN_PERSON` | any | null | null |
| `JITSI` | `public` | `<APP_URL>/sessions/<id>` | `https://meet.jit.si/Petrios-<UUID>` |
| `JITSI` | open `self-hosted` | `<APP_URL>/sessions/<id>` | `https://<domain>/Petrios-<UUID>` |
| `JITSI` | `jaas` / self-hosted with JWT | `<APP_URL>/sessions/<id>` | `<APP_URL>/sessions/<id>/teacher-rsvp/<code>` |
| `JITSI` | unavailable (configuration error) | `<APP_URL>/sessions/<id>` | RSVP URL |

Members always get the session page, in every mode: it mints the pass (token
modes), explains the meet.jit.si new tab and first-arrival sign-in (public
mode), and attempts their check-in, none of which a raw room URL would do; the
link survives sign-in (`next`). External teachers have no check-in and cannot
read the session page, so they get the raw room where it works without a pass
and their RSVP page (which mints one) otherwise. Token-mode links stay valid
once an operator fixes a broken configuration. The invite code is URL-encoded.
`sessionMeetingUrl` never throws: without a resolvable public app URL
(`getAppUrl()` throws in production when none is configured) it logs once and
returns the raw room where one works without a pass, otherwise null, so one
`JITSI` session cannot fail the ICS feed, the API or an email batch (the manage
page then links the relative session page). Callers: the ICS feed,
teacher invitation/reminder emails and session reminders (members), session
reminders to external teachers (their RSVP page, via
`lib/session-reminder-links.ts`), the RSVP page, the manage page, and the
`/api/v1` `meeting_url` (member audience; spec 09). `lib/meeting/location.ts`
holds the client-safe `storedMeetingUrl`/`sessionHasOnlineJoin`. Emails sent
before a mode change keep their old links: raw meet.jit.si room URLs still open
meet.jit.si rooms. Moderators who need a raw room link for an account-less guest
(public or open self-hosted only) copy it from the manage card.

### Manage card

The session-management **Overview** tab contains the meeting control. Jitsi
sessions show a Petrios Meet card for the active mode: token modes explain that
every participant joins with a Petrios room pass (members on the session page,
accepted external teachers from their invitation link), that there is no public
room link, and (JaaS) that recording, live streaming and transcription are off
and guests without an account must be invited as teachers; public mode explains
the new-tab meet.jit.si room and the first-arrival sign-in and shows the room
URL; an open self-hosted server shows the guest room URL; both of those say the
session page offers the room only within the window while the raw link works at
any time (the window note proper is shown only for token modes, where it is
enforced); a self-hosted token-mode card says hosts moderate only if the Jitsi
server applies the moderator flag; a configuration error shows the
configuration message (the page is moderator-only). The overview meeting link
("Open session room page" for `JITSI`) uses `sessionMeetingUrl(session, {
kind: 'member' })`, falling back to the relative session page.
Teams/hybrid sessions use the editable stored URL form. Interactive creation and
the main edit form also accept the optional Teams URL when the chosen location
is Teams or hybrid, so organisers do not need a second edit after creation.
User-supplied meeting links are trimmed, capped, and must be valid HTTPS URLs.
There is no separate Meeting Link tab.

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
3. An 8-character invite code (from the CSPRNG via `lib/codes.ts`, never
   `Math.random`, because an accepted code also unlocks a moderator room pass)
   is stored and an invitation row is durable before email is attempted.
4. The address book is best-effort upserted, filling blank names only.
5. Invitation email is attempted. Failure is returned as `emailSent: false` but
   does not remove the invitation.
6. The public RSVP page resolves the code: the invitation must match both
   `invite_code` and the URL's session id, and only then is the session read
   with the service-role `findSessionForInvitationAsSystem` pinned to the
   invitation's organization (signed-out visitors cannot read `sessions`
   through RLS, so an RLS read showed them no session card or form). A
   pending invite can be accepted or declined once, with self-reported names
   that both the RSVP form and the
   server action require. `respondToInvitation` returns
   `{ ok: true, status } | { ok: false, message, final?: true }` (spec 07): an
   unknown code returns "This invitation link is invalid or has expired.",
   blank names return "Please enter your first and last name", and an invite
   that is no longer pending returns "This invitation has already been
   responded to". The response update is a compare-and-set on
   `status = 'PENDING'`, so of two concurrent responses only the first is
   recorded and the other receives the already-responded failure. The
   unknown-code and already-responded failures are `final: true`: the form
   shows the message in a `role="alert"` block and refreshes, so the page
   renders "Already Responded" or "Invitation Not Found" instead of buttons
   that can no longer work. A successful accept also refreshes the page. For an
   accepted invitation the page shows the teaching room for a `JITSI` session
   (see Petrios Meet: embedded with a moderator room pass, or the meet.jit.si
   link) and the stored Teams link (from `sessionMeetingUrl` with the
   external-teacher audience) otherwise.
7. RSVP names overwrite address-book names because the contact is treated as the
   authoritative source.

An accepted external teacher is included in session reminders and selected
teacher-release flows; their reminder links point at their RSVP page. The
accepted invitation is also the capability for a moderator room pass in that
session's Petrios Meet room, within the room window, once
`TEACHER_INVITATIONS_RLS_LOCKED=true` (Petrios Meet above). Acceptance does not create an internal user, department
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
- a token: HMAC-SHA256 keyed by the service-role key over
  `petrios:calendar-feed:v2:<orgId>`, truncated to 128 bits (`lib/calendar-feed.ts`,
  compared in constant time); and
- optional `departmentId`.

Only server pages build the URL (`calendarFeedPath` with the viewer's own
current organisation: the dashboard and the department schedule page); there is
no client-callable action that mints one. The earlier 32-bit string hash was
linear in the secret, so one valid pair yielded every organisation's token, and
the `getCalendarSubscriptionUrl` Server Action minted a token for any `orgId` a
caller supplied without authentication. Both were removed in the same change;
every URL issued before it stops working and members copy the new link from
their dashboard.

After token validation, it returns published organization sessions (optionally
filtered by department), title, description, times, location, and meeting URL.
The feed is for organisation members, so `lib/ics-event-links.ts` resolves each
meeting URL with `sessionMeetingUrl(session, { kind: 'member' })` (the meeting
configuration is resolved once per feed): every Petrios Meet room appears as
the Petrios session page (in every mode, so opening it attempts check-in and
survives sign-in); without a resolvable public app URL a room that works
without a pass falls back to its raw URL and a token-mode room to the plain
"Petrios Meet (Video)" label.
`JITSI` events also carry that link as the VEVENT `URL`.
It uses `PUBLISH`, one-hour TTL metadata, and response headers that disable HTTP
caching.

Security limitations:

- it rotates whenever the service-role key changes (every subscriber must copy
  the link again);
- it appears in query strings and should be treated as a capability secret;
- `departmentId` is not cryptographically bound separately—the token authorizes
  the organization feed and the server applies the requested filter; and
- there is no revocation per subscriber or feed URL.

The token proves the URL was issued for that organisation; it is not a
per-subscriber credential. Per-subscriber revocation would need stored random
feed credentials.

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
location, resolved meeting URL, and session link, both resolved per recipient
by `reminderLinksFor` (`lib/session-reminder-links.ts`): members get
`sessionMeetingUrl(session, { kind: 'member' })` and the session page; external
teachers get `sessionMeetingUrl` with their invite code (the raw meet.jit.si or
open self-hosted room, else their RSVP page) and their RSVP page as the session
link, because they cannot open `/sessions/<id>` and token-protected rooms are
joined from the RSVP page. The meeting configuration is resolved once
per run.

Each recipient has a `session_deliveries` row with
`delivery_type = 'SESSION_REMINDER'` and `related_id` = the session id (non-null
so the natural unique key applies), keyed by lower-cased email; two registered
profiles sharing an email therefore receive one reminder. The job reads the
session's reminder ledger once, skips recipients already `SENT` or `FAILED` after
three attempts (`SESSION_REMINDER_MAX_ATTEMPTS`), and sends to the rest through
the normal get-or-create, 15-minute claim lease, and attempt record. A provider
`{ error }` result or a thrown send is recorded as `FAILED`; `emailsSent` counts
provider-accepted sends only.

The `reminder_sent_at` watermark is written only after a pass in which every
recipient is `SENT` or has exhausted its attempts, no recipient was left
unreached by the run budget, and no claim was held by another run. Otherwise the
session stays selectable and the next run retries only unfinished rows. A
session leaves the selection window when it starts, which bounds retries. A
session with no recipients is watermarked immediately. Each run uses the shared
cron work budget (spec 07; reserved per session 8, per ledger lookup 2, per send
5), and the JSON response adds `deferredSessions` and `deferredRecipients`. An
interrupted or capped run never re-emails a recipient whose row is `SENT`; only
a crash between provider acceptance and the ledger write can repeat that one
recipient, after the 15-minute lease.

## Post-session reporting eligibility

The post-session report job selects published sessions whose attendance is
`FINALIZED`, whose end is at least 24 hours in the past, and whose report
watermark is null, oldest end first, with a fixed batch cap of 10. Sessions
awaiting finalization are not selected, so they never take batch slots from
finalized work. It does not recompute or infer attendance. The job emits the
attendance event for the final revision and issues attendee recognition through
the per-recipient delivery ledger described in specs 03 and 05. Each run uses
the shared cron work budget (spec 07; reserved per session 15, per certificate
lookup 1, per exact delivery lookup 1, per recipient delivery 20). Each session
spends from its own slice of the run budget, which holds back 400 units for
every later session in the batch, so a session that cannot finish in one run is
deferred on its own and the sessions behind it are still processed. An
attendee already delivered costs at most 2 units, so every run makes progress on
every selected session. Attendees a run does not reach are picked up by the next
run, the watermark stays open until a single pass completes every recipient,
and the JSON response adds `deferredSessions` and `deferredRecipients`. It does
not issue teacher certificates.

## Session documents

Every session page has a Documents tab. Metadata lives in the deny-all-RLS
`session_documents` table and objects live in the private Supabase Storage bucket
`session-documents`. No public bucket URL or general browser object policy is
created.

### Upload authority and limits

A department moderator or an `ACCEPTED` registered session teacher may upload.
Each upload action (prepare, finalize, cancel) re-resolves session and
organization scope and repeats this check before using the service DAL. Other
session users can list/download documents if the normal session read authorizes
them; archived objects are visible only in the moderator management view and
are not downloadable.

Supported formats and exact MIME types are:

| Extension | MIME type | Browser behavior |
|---|---|---|
| `.pdf` | `application/pdf` | Same-origin authenticated inline view or download |
| `.docx` | Open XML Word MIME | Download |
| `.pptx` | Open XML PowerPoint MIME | Download |

The maximum is 25 MiB in application validation (the declared size at prepare
and the streamed byte count at finalize), the bucket `file_size_limit`, and the
database check. File bytes never pass through a Server Action, so Next keeps its
default 1 MB Server Action body limit. Legacy `.doc`, `.ppt`, macro-enabled
files, and all other formats are rejected.

### Validation and storage sequence

Upload is a three-step, browser-direct flow, so the application server
(including a 128 MB Workers isolate) never buffers file bytes.

1. **Prepare** (`prepareSessionDocumentUpload`) sanitizes path/control
   characters from the display filename and checks extension/MIME agreement and
   the declared size (1 byte to 25 MiB). It inserts the `UPLOADING/PENDING` row
   with the unguessable object path `<org>/<session>/<document UUID>.<extension>`
   and returns a one-shot, non-upsert Storage signed upload URL for exactly that
   path, rebuilt on the public Supabase origin. The token authorizes that single
   write; no browser object policy exists. The bucket `file_size_limit` and
   `allowed_mime_types` still apply.
2. **Browser upload.** The client PUTs the file straight to Storage
   (`lib/session-documents-upload.ts`, a plain `fetch` mirroring storage-js
   `uploadToSignedUrl`; components import no Supabase client). If the PUT fails,
   the client calls `cancelSessionDocumentUpload`, which, for the caller's own
   `UPLOADING` row only, marks it `REJECTED` and removes any object.
3. **Finalize** (`finalizeSessionDocumentUpload`) requires the row to be
   `UPLOADING`, in this organization and session, with `uploaded_by` equal to the
   caller. It streams the stored object once through
   `lib/session-documents-inspection.ts` with bounded memory (an approximately
   1.1 MiB tail window; the whole object is never held), computing SHA-256 and
   the true byte count, which must equal the declared size and stay within
   25 MiB. Content checks:
   - PDF must begin `%PDF-`;
   - Office files must begin with a ZIP local-file signature, and the whole-file
     byte rules apply: any `vbaProject.bin` bytes reject, and
     `[Content_Types].xml` and the `word/` or `ppt/` prefix must appear; and
   - the ZIP end-of-central-directory record is parsed (ZIP64 supported,
     multi-disk and entry-count mismatches rejected) with a central directory of
     at most 1 MiB; it must list `[Content_Types].xml` and an entry under
     `word/` (DOCX) or `ppt/` (PPTX), and any entry name containing
     `vbaProject.bin` rejects. Entry-name checks are case-insensitive, as OPC
     part names are.

Success moves the row from `UPLOADING` to `AVAILABLE/BASIC_VALIDATED`
(compare-and-set) with the computed SHA-256 and appends
`SESSION_DOCUMENT_UPLOADED`. On a validation or storage failure the row is first
claimed `REJECTED` only while still `UPLOADING`, so a duplicate finalize or a
late cancel cannot remove an `AVAILABLE` document; then the object is removed.
If the activity event cannot be appended after availability, the document is
still rejected. Because the row exists before the bytes arrive,
content-validation failures leave a `REJECTED` row. Upload and archive actions
append session activity events. Completed permanent deletions append an
operational activity event on a best-effort basis.

Current limitation: a browser that disappears between prepare and finalize
leaves an unlisted `UPLOADING` row and possibly an unvalidated private object.
Signed upload tokens remain usable for about two hours, so an authorized uploader
can still write an object to a path whose row was already rejected; such an
object is private and never served. No sweeper removes either yet.

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
document DAL, and enforces the 50 MiB combined product limit. Documents are not
downloaded up front: each private object is read from storage one at a time
(`fetchDocumentObject`) while it is sent — on Anthropic as its own Files API
upload, on the OpenAI-compatible adapter inside one streamed request body. Its
byte count and SHA-256 are checked incrementally against the
`session_documents` values recorded at upload. A mismatch, an object larger than
recorded, or a storage read failure fails generation with the original
integrity or storage message, and no output is accepted. On the adapter it errors
the request body before that document's data URL, and therefore the JSON, is
complete. On Anthropic it errors a PDF upload before its closing multipart
boundary, so the upload never completes (any file the endpoint nonetheless
stored is deleted); DOCX/PPTX text is used only after the whole object passed
the check. Unlike a verify-before-send flow, PDF bytes (and, on the adapter, any
document's bytes) preceding a mismatch may already have reached the provider
inside that aborted, incomplete request.

With Anthropic (default), PDFs are uploaded to the Files API as bytes and
contribute text and page images; DOCX/PPTX are converted server-side to plain
text (DOCX body in document order; PPTX slides in presentation order with
speaker notes; headers/footers, comments, masters/layouts and document
properties are not extracted; at most 1,000,000 characters per document,
inflation capped at 64 MiB, at most 2,000 slides) and uploaded as text, so
embedded charts or images do not inform the recap. Each upload has an opaque
`petrios-ai-` name and a one-hour expiry, and is deleted when the generation
ends; a daily sweep removes anything an interrupted request left. On the
OpenAI-compatible adapter the bytes go in one Responses file-input call (PDFs as
text and page images, DOCX/PPTX as provider-extracted text). Users are warned
before upload/generation not to include patient-identifiable, confidential, or
unnecessary special-category material.

In the same provider request, generation requires hosted web search limited to
the authoritative clinical/evidence domains specified in spec 06. Search queries
may be derived from the private learning material. On Anthropic, the spoken script is the text the model writes after its last search result; working notes written before or between searches are discarded. Research can add relevant
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
status before a service-role object read. The route streams the object from
Storage (`fetchDocumentObject`) to the client without buffering it and sets
`Content-Length` from the stored, validated `byte_size`. Responses use the stored
MIME type, safe RFC 5987 content disposition, `private, no-store`, and
`nosniff`. Only PDFs honor `?view=1` as inline; Office files always download, so
no Word/PPT webviewer or conversion service is introduced.

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
The chosen day and start time are wall-clock time in `APP_TIME_ZONE` (default
`Europe/London`): `createTeachingSlots` runs on the server and converts them to
UTC instants with `appWallClockToIso` before insert, and the past-day check uses
the app-zone calendar day (`appDayKey`). A spring-forward time that does not
exist resolves an hour later. Slot descriptions (`describeSlot`: offer emails,
the schedule list, the open-slots panel, the `/claim` page) and the schedule's
busy-day tags are computed in `APP_TIME_ZONE`; the client panels that call
`describeSlot` receive the server's `appTimeZone()` as a prop (spec 07), so a
non-UK `APP_TIME_ZONE` shows the same times on every surface. Slots created before this
rule for British Summer Time dates were stored with the wall time read as UTC,
one hour later than the moderator chose (and draft sessions claimed from them
inherit the offset). Before the change, offer emails rendered on a UTC server
happened to show the intended time while browsers showed the late one; after
it, every surface consistently shows the stored (late) time.

**Release blocker — data decision pending (product owner).** No data
correction has been applied, and the code cannot tell an affected row from a
deliberately late slot. Before or at the release, an operator lists the
affected live rows read-only, with `<release>` set to the deploy instant:

```sql
select id, department_id, status, date_start, date_end, session_id, created_at
from teaching_slots
where status in ('OPEN', 'CLAIMED')
  and created_at < '<release>'
  and date_start > now()
  and (date_start at time zone 'Europe/London')
      - (date_start at time zone 'UTC') = interval '1 hour';
```

The product owner then chooses one of:

1. subtract one hour from `date_start`/`date_end` of those rows, and of each
   linked session that is still `DRAFT` and still starts at the slot's original
   `date_start` (a moderator-edited session is left alone). The active-slot
   unique index on (department, start) can reject a shifted row that would
   collide with an existing slot, which then needs a manual decision; or
2. leave the rows and ask each affected moderator to close and re-create those
   slots (claimed ones: correct the draft session time by hand).

Record the chosen option, the date and the row count here when it is done.

A parent slot range may be split into 10-, 15-, or 20-minute lightning slots. Splitting happens
after parent validation and drops a trailing remainder shorter than the split
size. A slot of 20 minutes or less is labelled Lightning.

The slot start-time picker uses the same 08:00–17:30 quarter-hour window as
session creation. This is a UI default range, not a database restriction on
historical or API-created slot instants.

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

The visitor has no org session, so the external claim reads the slot with the
service client (`findSlotAsSystem`) and acts on it only after the claim code
and the publication offer are verified; the org-member RLS read would hide
every slot from it.

Before the compare-and-set, both actions classify the loaded slot
(`claimPrecheck` in `lib/slot-schedule.ts`). A slot the caller already holds
(`claimed_by_user_id` or `claimed_by_contact_id` matches, typically a retry
after a lost response) returns success with its linked session, or "You have
already claimed this slot." while no session is linked. A slot that is not
`OPEN`, or whose start has passed, returns "This slot is no longer available."
without attempting the claim.

The winning operation is one database update with predicates `status = OPEN` and
`date_start > now`. It records claimant identity/name/topic and changes the slot
to `CLAIMED`. `claimSlotByCode` and `claimSlotAsMember` return
`ClaimSlotResult`, `{ ok: true, sessionId, rsvpPath? } | { ok: false, message,
slotUnavailable?: true }` (spec 07). A fresh external claim returns `rsvpPath`
(`/sessions/<id>/teacher-rsvp/<code>`), and the confirmation asks the claimer to
keep that page: it is where they join the video room (their 24-hour reminder
links to it too). A retried claim does not repeat it. A slot that no longer exists or is
unavailable ("This slot is no longer available."), or a compare-and-set lost to
a concurrent claimant ("Sorry — this slot was just claimed by someone else."),
returns `slotUnavailable: true`, and the claim UIs refresh to drop the slot. An invalid link, a blank name, or a
slot not offered to the claimant returns a plain failure. A failure after the
claim is won is still compensated (the slot is reopened, below) and thrown.

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
  report watermarks, and rota flags (a time change or cancellation deletes
  them; spec 14).
- Use `sessionMeetingUrl(session, audience)` for new outbound surfaces and
  choose the audience deliberately (external teachers cannot open session
  pages); never put a raw `8x8.vc` or token-protected room URL in a message.
- State teacher status filters explicitly (`PENDING`, `ACCEPTED`, `DECLINED`).
- Keep slot claim concurrency in a database predicate and document compensation.
- Treat invite, claim, and calendar codes as capabilities and avoid logs.
- Add forward migrations/tests/spec changes for any new status or location.
