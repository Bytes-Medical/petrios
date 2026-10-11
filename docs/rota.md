# Rota availability: operator guide

Rota availability lets a department upload its trust rota so that, after a
teaching session, the moderator sees which trainees were **rostered
unavailable** and can excuse them one by one. It is off by default. This guide
is for the operator, the organisation's admin, the rota coordinator, and
moderators. The contract is [spec/14](../spec/14-rota-availability.md). A
one-page [coordinator quick guide](#rota-coordinator-quick-guide) is at the end.

What it does and does not do:

- Petrios suggests; a moderator decides. Nothing is excused automatically, there
  is no "accept all", and finalizing attendance never reads rota data.
- The rota file is read **in the coordinator's browser**. When the coordinator
  checks matches, the staff number or email of **every row in the file** is
  checked once against the department's trainees and is not stored, so export
  only the department's doctors in training. Petrios then receives one status
  letter per person per day for matched trainees. The file, shift codes, names,
  and leave reasons never leave the device.
- No leave category is stored or shown. Sickness can never be told apart from
  any other reason someone was away.
- Scheduling availability counts and an automated push API are **not built**.

## 1. Prerequisites

Do all of these before switching anything on.

| Item | Who | Notes |
|---|---|---|
| DPIA approved, with a reference number | Trust DPO / IG lead | Use the "Rota availability integration" section of [the DPIA template](compliance/dpia-template.md). Record the DPO's advice, the Article 8A purpose-compatibility assessment, the Article 6(1)(e) basis, the Article 9 conclusion, and staff-side views |
| Staff privacy notice updated | Trust | Wording in the DPIA template. Petrios's `/privacy` carries an adapted version |
| Article 28 processing agreement (or a data-sharing agreement if the Petrios organisation is a different body from the employing trust) | Trust and Petrios operator | |
| Rostering Information Asset Owner approval; licence allows the export | Trust | Doctors in training only, from 2 weeks back to 8 weeks ahead |
| Code rules agreed (post-night rest, which codes are on duty elsewhere, which codes are nights) | DME and Guardian of Safe Working Hours | About an hour; record the agreed map |
| Migrations `063_rota_availability.sql` **and** `064_recall_excused_catchup.sql` applied and checked, in the same release | Owner | Apply with the normal migration path (either order). Rota stays "not available" until 064 is in place: a confirmed rota excusal makes a trainee `EXCUSED`, and only 064 keeps the Audio Recap catch-up open to them. 064 widens the catch-up to every finalized `EXCUSED` expected attendee, rota or not (spec 08), re-opens still-open catch-up packages so their excused attendees are invited, and makes the latest moderator decision win (spec 03); apply it deliberately |
| `ROTA_IDENTITY_SECRET` set | Operator | Server-only, at least 32 random bytes (`openssl rand -base64 48`). On the production Worker a secret (`npx wrangler secret put ROTA_IDENTITY_SECRET --env production`); on Docker/self-hosting an environment variable. **Rotating it orphans every identity link**, so every trainee must be re-linked: treat it as set-once |
| `ROTA_INTEGRATION_ENABLED=true` | Operator | Exactly `true`, on the **production runtime only**. On the production Worker, the owner edits only `env.production.vars.ROTA_INTEGRATION_ENABLED` in `wrangler.jsonc` from `"false"` to `"true"` and runs `npm run cf:deploy:production -- deploy` (never a secret: it would shadow the var; runbook in [docs/cloudflare-workers.md](cloudflare-workers.md#rota-availability-on-workers)). On Docker/self-hosting, an environment variable. Never on the Workers staging Worker, which serves the production database and stays pinned to `"false"` |

Until all of these hold, every rota page returns 404 and every rota action
answers "Rota availability is not available.". While the switch is off the
Settings section is hidden, unless the organisation still holds rota data (see
§7). Code shipped before the migrations is inert: missing tables are treated as
"unavailable", never as an error.

## 2. Org-admin setup

In **Settings → Rota availability** (shown while the switch is on):

1. **Governance.** Enter the DPIA reference (3–120 characters), confirm that the
   staff privacy notice has been updated, and set retention (days after the
   later of attendance finalization and the catch-up closing; default 30,
   1–90, never later than 90 days after the session) and the upload horizon
   (days ahead; default 56, 7–84). Then press **Save governance**. Saving does
   not switch anything on.
2. **Enable.** Refused until the governance fields are saved ("Enter the DPIA
   reference and confirm the privacy notice first."). The database enforces the
   same rule.
3. **Enrol the pilot department.** Only enrolled departments can upload or show
   suggestions. Keep it to the pilot department at first. **Remove** asks for
   confirmation: it deletes the department's rota suggestions and removes its
   uploaders.
4. **Give the rota coordinator an account and the uploader role.**
   - The coordinator must be a member of the organisation, and **must not be a
     trainee of the teaching department** (refused: they could otherwise mark
     themselves available).
   - Joining an organisation always joins a department too, and every member of
     a department is snapshotted as an expected attendee when its sessions are
     finalized. So **do not invite the coordinator into the teaching
     department**, or they will be recorded absent and sent catch-up invitations
     for every session. Instead create a separate department with no teaching
     sessions (for example "Medical staffing"), and send the coordinator that
     department's invite link (Settings → Department Invite Links).
   - Once they have joined, enter their email under **Rota uploaders** for the
     teaching department. The grant is per department and lets them upload and
     see "matched / not matched" only: no names, no roster, no suggestions, and
     no counts that would reveal anyone's flag or a decision.
   - Send them the address `https://<your Petrios address>/rota` and the
     [quick guide](#rota-coordinator-quick-guide). There is no menu link.

## 3. What the rota coordinator does

**Once a week**, export the rota for **two weeks back to the upload horizon
ahead** (eight weeks by default) as a CSV and select it on the department's
**Rota** page (`/rota` lists your departments). The browser splits it
automatically: days before today are sent as *as worked*, days from today as
*planned*. You do not need a separate upload before each session is finalized:
moderators finalize from whatever is there.

The six steps are **File → Columns → Codes → Post-night rest → Identity →
Upload**. First time only:

1. **Columns.** Choose the layout: *grid* (one column per date) or *list* (one
   row per duty). Pick the staff number column (ESR assignment or local staff
   number, preferred), the email column (second best), and the name column
   (last resort; names are used only in a moderator's browser). Staff numbers
   are compared upper-cased with spaces removed and must be at most 64
   characters of `A–Z 0–9 . _ / -`; with *strip assignment suffix* on,
   `21000001-1` and `21000001-2` count as the same person. For a list layout
   also pick the date and code columns, and start/end if the export has times.
   Choose the date format. The step shows how many dates it recognised; if it
   says "No column headers read as dates", the date format is wrong (grid
   headers need the year, for example `05/10/2026`). Only header names are
   saved.
2. **Code dictionary.** Every code in the file is listed with its count. Map
   each to a letter, or to *ignore*, using the rules agreed with the DME and the
   Guardian of Safe Working Hours. **Upload stays disabled until every code is
   mapped.**

   | Letter | Use for |
   |---|---|
   | `A` available | A normal day shift (teaching is protected time) |
   | `D` on duty elsewhere | On-call or a long day that clashes, per code. A night on call: tick **Night** and give its times, so post-night rest follows it |
   | `N` nights or rest | Night shifts: tick **Night** and give the start and end time. A nights code whose times cross midnight also counts as a night. A nights code with no times is read as a **whole rest day**, not a night (the row says so) |
   | `X` not working | Rostered off, zero days |
   | `L` leave | **Every** kind of leave: annual, study, sick, parental, union, other |
   | ignore | Codes that say nothing about availability; they count as unknown |

   In a cell with several codes, such as `LD/OC`, anything other than `A` wins.
3. **Post-night rest.** On by default: after the last night of any run, the
   trainee is treated as resting for 46 hours from the end of the night (a night
   ending Tuesday 09:30 rests until Thursday 07:30). You can switch the trigger
   to "3 or more nights" or turn it off if your agreed rules say so. A code in
   the export always wins **for the hours it covers**; the inferred rest fills
   the rest of those days (so a new night starting inside the rest window still
   leaves its daytime as rest). Across a clock change the rest period can be
   out by one hour.
4. **Save the profile.** Next week's upload is then: select file → check →
   upload.

Every upload:

- **"N rota rows not matched"** means Petrios could not link those rows to a
  current trainee of the department. Most are usually people who are not
  trainees in the department, which is expected. A trainee you expected to
  match is usually a new starter or has a new assignment number after
  rotation: tell a department moderator, who can link them by staff number on
  the department's rota page (no file needed). Unmatched rows are dropped in
  your browser and only counted. "New unmatched since last upload" helps after
  a rotation changeover.
- A day left blank in the export is "unknown": it never removes a suggestion
  an earlier upload made.
- You get **one** match check per upload and at most 10 a day, and the upload
  can only send rows from that check. Refreshing the page starts a new upload.
- An extra upload is needed only when the rota changed on the day (swaps,
  sickness). Enter changes in the rostering system first so the *as worked* days
  are right.
- Never upload a real export anywhere else, never email it to Petrios or to
  anyone else (moderators can link people without it), and never attach one to
  a support request.

## 4. Moderator duties

**Linking people.** On the Rota page a moderator sees, for each row the server
could not already match, suggestions by email or name against the department's
trainee list. Nothing is pre-ticked: confirm each person individually. A
confirmation on a row with a staff number (or else an email) is remembered as a
keyed code; a confirmation by name alone is not stored and must be repeated on
every upload. **Linked staff** lists the links (name, how linked, when; never
the identifier) and lets you revoke one. **Link a trainee by staff number**
(below the list) links a trainee from the staff number and/or email the rota
uses for them: use it for new starters after the August or February
changeover, so the coordinator never has to send you the export. Tick
*Remove an assignment suffix* only if the upload profile does the same.
Trainees cannot link themselves.

**Reviewing suggestions.** On *Manage → Attendance* the **Expected roster**
panel lists trainees with no check-in or other presence evidence. Someone the
rota had away reads:

```text
Suggested: excused (rostered unavailable) · rota as of Wed 14 Oct 06:00 (as worked)
```

- The panel appears once the session starts but Confirm stays disabled until
  it ends (`Confirm opens after the session ends.`), so a late check-in cannot
  be hidden by an early excusal.
- **Confirm** records an excusal for that one person with the reason
  "Rostered unavailable (rota)". **Dismiss** leaves their attendance alone; it
  cannot be undone, so it asks first. There is no bulk action. Both leave a
  lasting entry in the session's activity history.
- If you see `Suggestions for this session come from the planned rota…`, no
  as-worked upload covers the session's day yet. This is information only: you
  do not need to wait for the next weekly upload to finalize.
- Markers: `Contested by trainee` (the trainee says the rota was wrong: decide
  manually with the normal attendance tools), `Rota changed since you
  confirmed` (a newer upload no longer shows them away: review it), and
  `Attendance evidence received after excusal` (review and correct if needed;
  the latest moderator decision wins).
- A trainee who has completed the Audio Recap catch-up is not listed: the
  completed catch-up is already the decision.
- Finalize as usual. Anyone without evidence or an excusal becomes `ABSENT`;
  if suggestions are still undecided, the finalize confirmation says how many
  will be recorded as absent. Missing or wrong rota data never blocks
  finalizing.

To undo a confirmed excusal after finalizing, reopen with a reason and record a
new moderator decision; the latest decision wins.

## 5. Trainee experience

On the session page a trainee the rota had away sees a note that follows its
state, for example, before the session:

> Your department's rota shows you as unavailable for this session. If you can
> attend, please do. After the session your moderator decides how the rota is
> used. **[This is wrong]**
>
> Missed teaching can still be exception-reported to your educational
> supervisor.

After a confirmation it reads "Your moderator recorded you as excused
(rostered unavailable) for this session."; after a dismissal "…Your moderator
did not use the rota for this session.". **This is wrong** asks for
confirmation (it cannot be undone, and it should not be used by someone who
really was away), then reads "You told us the rota was wrong. Your moderator
will decide manually." Trainees see only their own note, for any session, at
any time. If excused, they keep the optional Audio Recap catch-up; completing
it records transparent catch-up `PRESENT`. The catch-up email never mentions
the rota.

## 6. Retention and the purge

| Data | Deleted |
|---|---|
| Session note (flag) | The organisation's retention days (default 30) after the later of attendance finalization and the catch-up closing; never later than 90 days after the session. Also when the session is moved or cancelled, the trainee leaves the department, the department is un-enrolled, or rota is disabled |
| Identity link | When the person is no longer a trainee in an enrolled department, on revocation, or on disable |
| Uploader grant | When the person leaves the organisation, or on revocation |
| Upload and preview audit (counts and a keyed digest) | After 12 months |
| A confirmed excusal, and the confirm/dismiss/contest activity entries | Never by the purge: they are part of the attendance and session record |

The purge runs on every upload and on every hourly `post-session-reports` cron
run (its JSON response includes `rota_purged`). It runs **even while the switch
is off**, so data already stored still expires. Expired notes are hidden
immediately, before the purge deletes them.

## 7. Disabling

1. **Disable per organisation**: Settings → Rota availability → Disable, type
   `DISABLE`. This immediately deletes the organisation's session notes and
   identity links. Profiles, uploader grants, enrolment, and the audit are
   kept, so re-enabling later needs no new setup (but trainees must be
   re-linked).
2. Then, if wanted, set `ROTA_INTEGRATION_ENABLED` to anything other than
   `true` (or remove it). The purge keeps running from the cron.

If the switch was turned off first (an emergency), the deletion controls still
work: while the organisation still holds rota data, Settings shows a
cleanup-only Rota availability section with **Disable**, **Remove** for
enrolled departments and **Remove** for uploaders, and moderators can still
revoke links. Identity links have no time limit while the organisation stays
enabled, so disable after an emergency switch-off.

## 8. Troubleshooting

| Message or code | Meaning | What to do |
|---|---|---|
| Page 404 / "Rota availability is not available." | Switch off, secret missing or short, migration 063 or 064 not applied, organisation not enabled, or department not enrolled | Check section 1 and Settings. A missing secret logs `[rota] ROTA_IDENTITY_SECRET missing or too short` once |
| "You do not have access to rota availability for this department." | Not a moderator, org admin, or uploader for this department in your current organisation | Super admins acting in another organisation are refused by design |
| `disabled` — "Rota availability is not enabled for this department." | Organisation disabled or department not enrolled | Settings |
| `invalid_payload` — "The upload could not be read. Reload the page and try again." | The batch failed validation (range, size, unknown value, a row not in the match check) | Reload; check the export covers −2 weeks to the horizon and at most 500 people |
| `preview_required` — "Check matches for this upload first. Reload the page to start a new upload." | The upload's match check is missing | Reload and run the steps again |
| `rate_limited` — "The daily limit for match checks is reached. Try again tomorrow." | More than 10 match checks by a coordinator in 24 hours | Wait, or ask a moderator to upload |
| `too_large` — "This upload covers too many sessions at once…" | Over 100,000 person-session pairs | Export a shorter date range in two parts |
| `batch_conflict` — "This upload was already sent with different content. Reload the page to start a new upload." | The same upload was reused with different content, or sent twice | Reload the page |
| `trainee_uploader` — "A trainee of this department cannot upload its rota…" | The chosen uploader is a trainee of that department | Choose a coordinator who is not (section 2) |
| `link_refused` — "Not linked: that staff number or email is already linked to a trainee of another department." | Anti-hijack rule | Check the number; the other department's moderator can revoke it |
| `not_found` — "Session not found." | Wrong session or organisation | |
| `not_confirmable` — "Suggestions can be confirmed only after the session has ended and before attendance is finalized." | Too early, already finalized, or not a policy-v2 published session | Wait for the end, or reopen |
| `not_eligible` — "This person is no longer a trainee in this department." | Membership changed | |
| `suggestion_changed` — "This suggestion has changed or was already decided. Refresh to see the latest state." | Someone else decided, a newer upload changed it, or the session moved | Refresh |
| `presence_evidence` — "This trainee has attendance evidence, so the suggestion no longer applies." | They checked in | Decide manually if needed |
| `caught_up` — "This trainee completed the catch-up, so the suggestion no longer applies." | The Audio Recap catch-up was completed (after a reopen) | Nothing to do; correct manually only if the catch-up itself was wrong |
| `already_decided` — "A moderator decision already exists for this trainee." | A manual decision exists | Use the normal correction flow |
| `dismiss_not_open` — "Suggestions can be dismissed only after the session has started and before attendance is finalized." | Dismissed before the start or after finalizing | Wait for the start, or reopen |
| "Something went wrong. Refresh the page and try again." | An unexpected server error (logged as a fixed `[rota] <label> failed` line) | Refresh; report it if it persists |
| Many unmatched rows after August/February | Rotation changeover: new assignment numbers | Moderator links the new starters by staff number (section 4) |

Logs never contain request bodies, identifiers, or names; rota errors are fixed
`rota:<code>` messages.

## 9. Staging stays off

The Cloudflare staging Worker serves the **production database**, so it pins
`ROTA_INTEGRATION_ENABLED="false"` in `wrangler.jsonc` and the deploy
validator refuses anything else
([docs/cloudflare-workers.md](cloudflare-workers.md)). On staging only check
that the feature is inert: the rota pages 404 and the actions refuse. Do any
functional testing against a local database with synthetic files only
(`lib/rota/__fixtures__/`; `node lib/rota/__fixtures__/generate-synthetic.mjs <YYYY-MM-DD> wide|long`
regenerates them around another anchor date, such as today); never use a real export outside
production.

## Rota coordinator quick guide

For the person who uploads the weekly rota. You only ever see "matched / not
matched": never anyone's suggestions or decisions.

**Before the first upload**

1. Your organisation admin invites you to Petrios (into a non-teaching
   department such as "Medical staffing") and gives you the rota uploader role.
   Sign in with the emailed link.
2. Bookmark `https://<your Petrios address>/rota`. There is no menu link; that
   page lists the departments you can upload for.

**Every week**

1. **Export** the rota from the rostering system for this department's doctors
   in training only, from two weeks back to eight weeks ahead (or your
   organisation's horizon). If the export is an Excel file, open it and use
   *File → Save As → CSV UTF-8 (Comma delimited) (.csv)*.
2. Open the department on `/rota` and work through the six steps:
   1. **File**: choose your saved profile and the CSV. Nothing is uploaded yet.
   2. **Columns**: check the columns and the date format. It must say how many
      dates it recognised.
   3. **Codes**: map any new codes (the agreed map from your DME and Guardian
      of Safe Working Hours). Tick **Night** for night shifts and give times.
   4. **Post-night rest**: leave as agreed.
   5. **Identity**: press **Check matches** once. You see how many rows matched.
   6. **Upload**: press **Upload**. You see counts only.
3. **Not matched?** Most unmatched rows are people who are not trainees here.
   If a trainee you expected is missing (a new starter, a new assignment
   number), tell a department moderator their name: they can link them on the
   rota page. Never email the export.

If you refresh the page you start again; you get one match check per upload
and ten a day.
