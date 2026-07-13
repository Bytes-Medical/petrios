# 04 — Sessions, teachers, scheduling, video

## Sessions

- Lifecycle: DRAFT → PUBLISHED → (CANCELLED). Only published sessions are
  visible to members, appear on calendars/ICS, and accept attendance.
- Duration is 30 min–4 h in 30-min steps (`lib/session-duration.ts`);
  create/edit pick a start datetime + duration, never an end datetime.
  Exception: sessions created from claimed **lightning slots** can be as
  short as 10 min — `EditSessionForm` preserves off-grid durations via
  `extraOptionMinutes`, so editing never silently snaps them to 30.
- `location_type`: `MS_TEAMS` | `IN_PERSON` | `HYBRID` | `JITSI`, labels in
  `lib/types.ts`. Optional `session_type` (STEPP / Clinical Skills /
  Simulation / Academic) drives calendar colours.
- Org-wide calendar (`components/SessionCalendar.tsx`, Schedule-X) with a
  tokenised public ICS feed (`app/api/calendar/ics`).

## Teacher assignment (two populations, one session)

- **Registered members**: rows in `session_teachers` with
  status PENDING/ACCEPTED/DECLINED. Invitees respond from the dashboard
  Teaching tab (`respondToTeachingAssignment`); accepting records TEACHER
  attendance evidence and notifies the inviter (bell + email via
  `lib/notify.ts`).
- **External teachers** (no account): rows in `teacher_invitations`, emailed
  a public RSVP link `/sessions/[id]/teacher-rsvp/[invite_code]`. Accepted
  externals are folded into reminders/certificates by email, deduped
  case-insensitively against registered recipients.
- A session is "unconfirmed" while nobody has ACCEPTED — the ops speaker
  chase keys off this.
- Accepted teachers get the ~24h reminder email (cron `session-reminders`,
  watermarked by `reminder_sent_at`).

## Teaching slots (Calendly-style availability)

- Moderators bulk-create OPEN slots (date + set time + location) on
  `/departments/[id]/schedule`; a partial unique index
  `(department_id, date_start) WHERE status IN ('OPEN','CLAIMED')` prevents
  double-booking identical start times.
- **Lightning slots**: the bulk creator's "Create as" option splits each
  day's range into back-to-back micro-slots (`splitSlotDraft`,
  `SLOT_SPLIT_OPTIONS` = 10/15/20 min; split AFTER `buildSlotDrafts` so the
  parent-range validation is untouched). Slots ≤ `LIGHTNING_SLOT_MAX_MINS`
  (20) carry a "Lightning" badge and first-time-teacher copy on the claim
  surfaces, appear as "Available — 15 min" on the calendar, and are marked
  in offer emails. Split slots have distinct `date_start`s, so the unique
  index still applies per micro-slot.
- **Publishing**: a `slot_publications` row snapshots the audience
  (contact groups, all department members, all org members — combinable);
  recipients are deduped member-wins over contact
  (`dedupeSlotRecipients`, `lib/slot-schedule.ts`). Each recipient gets a
  `slot_claim_links` row; externals' rows carry a `claim_code` capability
  token for the public `/claim/[code]` page, members claim in-app
  (authorized by the existence of their link row).
- **Claiming is first-come-first-served and atomic**: `claimSlot` is a CAS
  (`UPDATE … WHERE status='OPEN' AND date_start > now() RETURNING`), then a
  DRAFT session is created with the claimer attached as an ACCEPTED teacher
  (+ TEACHER evidence, + external invitation row for externals);
  `revertClaim` compensates on downstream failure. The slot's
  `location_type` is copied to the session — so a JITSI slot yields a
  video session automatically.
- Slot lifecycle: OPEN → CLAIMED or CLOSED; expired OPEN slots are filtered
  by query, never rewritten; CLAIMED never auto-reopens.

## Petrios Meet (built-in Jitsi video)

- `location_type='JITSI'`: the room is **derived, not stored** —
  `jitsiRoomName(sessionId)` = `Petrios-{uuid}` on
  `NEXT_PUBLIC_JITSI_DOMAIN` (default meet.jit.si). Same trust model as a
  pasted Teams link (unguessable capability URL).
- `sessionMeetingUrl(session)` (`lib/jitsi.ts`) is the **single join-URL
  resolver** for every surface (ICS, reminder emails, teacher emails, RSVP
  page, calendar popover, manage page). Never read `teams_meeting_url`
  directly in UI or outbound code.
- The session page embeds the room (`components/JitsiMeetingPanel.tsx`,
  `@jitsi/react-sdk` via `next/dynamic` ssr:false). Join window: 30 min
  before start → 30 min after end. On `videoConferenceJoined` the panel
  fires the standard `checkIn(sessionId)` — video joins land in the
  attendance evidence pipeline as SELF_CHECKIN, subject to the normal
  check-in window.
- Calendar/manage UIs route JITSI joins through the session page (so the
  embed + auto check-in are used), while exposing the raw room URL for
  account-less guests.
- meet.jit.si caveat (surfaced in the panel): the first participant may
  need to sign in to Jitsi to open the room; self-hosting the domain
  removes this.
