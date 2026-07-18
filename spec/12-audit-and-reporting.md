# 12 — Audit, reporting, and equity views

## Scope

Petrios has three related governance/reporting surfaces:

1. `/audit` is an organization/department governance dashboard with aggregate
   cards, a recent-session table, certificate search, identified member
   attendance, grade-cohort equity, and PDF/CSV exports; and
2. a managed session's **Attendance** tab exposes lifecycle, roster, materialized
   results, evidence provenance, corrections, and finalization; and
3. the session **Activity Log** shows governed session events. Identified raw
   feedback remains a separate moderator-only Feedback/API path.

These are operational views over live application tables. They are not signed
statutory reports. Attendance evidence is append-only provenance, while
`session_activity_events` is an append-only operational event projection. The
activity table is not a complete record of every read, edit, authentication
event, provider action, or historical action before migration 045.

Several current calculations have narrower or broader scope than their labels
suggest. This document defines those calculations exactly and records the gaps so
that a downstream report does not silently assign them a stronger meaning.

## Authorization and department scope

### Dashboard access

`/audit` requires an authenticated user and a current organization. The page
redirects users without an organization to `/dashboard`.

Allowed departments are selected as follows:

| Actor | Departments included |
|---|---|
| Super admin | Every department returned for the current organization |
| Current-organization org admin | Every department in the current organization |
| Other user with `department_admin` membership | Only departments they moderate |
| User with none of the above | No access; page redirects to `/certificates` |

The server action repeats the access decision. A moderator with no moderated
departments receives `No audit access`. Once the department ids are derived from
trusted membership context, `lib/db/audit.ts` uses the service-role database
client for cross-user aggregation. Every new audit query must therefore accept
the already-authorized organization/department scope; it must not infer scope
from a client-supplied organization id.

The dashboard displays the names of all included departments. It has no
department selector: org-wide administrators always receive the combined view.

### Managed-session raw feedback endpoint

`GET /api/sessions/:id/feedback/audit` calls the same server action used by the
managed-session UI. The action requires a current organization, resolves the
session inside that organization, and requires moderator authority for the
session's department before using a service-role read.

The route catches every failure and currently returns HTTP 500, including
not-found and unauthorized cases. Callers must not interpret the status as a
precise authorization signal.

## Dashboard source snapshot

`getAuditPageData()` loads the following in parallel after authorization:

- headline statistics over all published sessions in the authorized scope;
- the 15 most recent-by-start-time published sessions;
- all certificate rows in authorized departments;
- department membership rows for role counts;
- the count of legacy pending `department_join_requests`; and
- deduplicated member attendance details.

The returned data is a collection of independent reads, not a database snapshot
transaction. Concurrent attendance, feedback, membership, or certificate writes
can make values within a single page response momentarily inconsistent.

No dashboard query reads cancelled or draft sessions for session metrics. Unless
specified below, “published” means exact `sessions.status = 'PUBLISHED'`.

## Headline statistics

With no date fields selected, the four cards use `computeStats()`.

### Sessions

`totalSessions` is the number of published sessions in the current organization
and authorized departments. There is no `date_start <= now` condition. Future
published sessions therefore count.

### Attendance rate

The headline attendance rate is:

```text
round(100 × count(existing attendance rows with PRESENT or LATE)
          / count(all existing attendance rows))
```

The denominator includes existing `ABSENT` and `EXCUSED` rows. A finalized
policy-v2 session materializes an expected roster, so its denominator includes
the current department-member/accepted-teacher snapshot described in spec 03.
Open/review sessions, future rows, and policy-v1 historical sessions may still
have only evidence-bearing subjects. Because this headline mixes all those
states and does not filter to finalized v2 revisions, it remains the positive
proportion of stored rows, not a clean programme-level expected-attendance rate.

Attendance rows from future published sessions are included if they already
exist. The result is rounded to a whole percentage point. If no attendance rows
exist, the value is zero.

### Feedback rating

The headline rating is the arithmetic mean of non-null
`session_feedback.rating` values across all published sessions in scope, rounded
to one decimal place. Every stored feedback row is equally weighted; sessions
with more responses contribute more values.

The stored rating is itself a rounded summary derived during submission.
Detailed feedback statistics calculate averages from normalized question answers
and can differ from this headline value. Null stored ratings are omitted. With
no ratings, the card receives zero and displays an em dash.

### Certificates

`certificatesIssued` counts certificate rows whose `department_id` is authorized.
It does not filter by certificate `VALID`/`REVOKED`/`LEGACY` status, session
status, issue date, or the published-session id set. Replacement and historical
rows count separately. This is a durable issuance-row total, not a current-valid
or unique-recipient total.

## Recent sessions and date filtering

### Server-side list

The Sessions tab is based on at most 15 published sessions ordered by
`date_start DESC`. It has no past-only filter. A cluster of future sessions can
therefore displace completed sessions from the list.

For each listed session:

- `attendanceTotal` is the number of existing attendance rows;
- `attendancePresent` counts `PRESENT` plus `LATE`;
- `feedbackCount` counts every feedback row, including rows with null rating;
- `averageRating` is the mean of non-null stored `rating` values, rounded to one
  decimal place, or null if there are none;
- `certificatesIssued` counts certificate rows for that session; and
- the lock icon reflects `sessions.attendance_locked`.

For finalized policy-v2 sessions the rows include snapshotted expected absences;
for other sessions they may not. The list itself does not display roster
expectation, revision, evidence timestamps, or source provenance. Clicking a
title opens the normal session page, whose own authorization rules still apply.

### Browser date filter

The From/To controls filter only the already-loaded 15 rows. They compare ISO
date strings against `dateFrom` and `dateTo + 'T23:59:59'`. They do not issue a
new database query and cannot recover older rows excluded by the server limit.

When either date is set, the cards are recomputed from the filtered recent rows:

- sessions is the filtered row count;
- attendance is the ratio of summed present counts to summed attendance-row
  counts;
- rating is the unweighted mean of the **per-session** average ratings; and
- certificates is the sum of certificate counts for filtered sessions.

That rating weights each session equally, unlike the unfiltered headline rating,
which weights each feedback response equally. Clearing both dates restores the
all-published-session headline statistics, even though the table still contains
only 15 sessions.

## Organization audit PDF

`generateAuditReportPDF(dateFrom?, dateTo?)` calls `getAuditPageData()` again and
then filters `recentSessions`. It therefore contains at most 15 sessions. The
filename `audit-report-all-time.pdf` means “no date filter over the recent
15-row list”, not a complete historical report.

The PDF contains:

- authorized department names and the requested date label;
- generation date in the server/runtime locale;
- session count;
- summed present (`PRESENT` plus `LATE`);
- summed existing attendance rows, labelled **Total Expected**; and
- a session table with start date, present count, total rows, percentage, and
  stored-rating average.

The “Total Expected” label remains stronger than this mixed dataset. Finalized
policy-v2 rows have a defined snapshot roster, but historical/open/review rows
may not. The PDF neither filters to final revisions nor identifies the roster
snapshot time. It omits certificates, feedback response counts, evidence
provenance, member details, and equity data.

PDF generation occurs in a server action, returns the entire document as base64,
and the browser constructs a download Blob. Generation is not persisted or
logged as a report artifact. There is no signature, stable report id, expiry, or
tamper-evident hash.

## Certificate register

The Certificates tab loads every `VALID`, `REVOKED`, and `LEGACY` certificate row
in authorized departments, ordered newest issuance first, with no page-size
limit. The current audit projection does not expose lifecycle status or
revocation reason, so the public verification link is required to see that
state. It displays/searches by:

- recipient name when `recipient_name` is stored;
- recipient email only in the limited resolution case below;
- session and department name;
- certificate role;
- public certificate code; and
- issue date.

For a certificate that has `user_id` **and lacks** `recipient_name`, the server
uses the GoTrue admin API to resolve the account email. If `recipient_name` is
already present, no email lookup occurs and `recipientEmail` is null. Although
new certificate rows can preserve `recipient_email`, the audit query does not
select it; external rows therefore still do not show an email in this table.

Search is client-side, case-insensitive substring matching over loaded values.
The code links to the public `/verify/:code` page. Authorized audit users can
therefore see and copy bearer-like public verification codes. Legacy, revoked,
and replacement certificates remain separate rows and affect both table totals
and headline counts.

## Member summary and individual attendance

### Role summary

The member summary counts `department_members` rows, not distinct users:

- total is the number of membership rows in all authorized departments;
- admins are rows with `department_admin` or `org_admin`;
- faculty and trainees are exact role-row counts; and
- pending requests counts legacy `department_join_requests` with `PENDING`.

A person in two authorized departments is counted twice. The browser currently
renders Total, Admins, Faculty, and Trainees; `pendingJoinRequests` is returned
but not displayed.

The current invite-code onboarding workflow uses `member_onboarding_requests`,
not `department_join_requests`. Its pending requests are absent from this count.
The older authenticated join-request actions and components remain in the source
tree but are not mounted by a page, so this number is not a reliable view of
current onboarding demand.

### Member rows

Member detail begins with membership rows from every authorized department,
then deduplicates by `user_id`. The first database-returned membership supplies
the displayed role and grade; the query has no ordering, so a multi-department
member's chosen role/grade is not deterministic. Profile email/full name are
joined for display.

The attendance denominator is every published session satisfying
`date_start <= now` across **all** authorized departments. The same denominator
is assigned to every displayed person, regardless of the departments to which
that person belongs. Only their `PRESENT`/`LATE` attendance rows increment the
numerator; a missing row is effectively absent.

In a combined multi-department view, a member of department A is therefore
penalized for department B sessions unless they also recorded attendance there.
The displayed percentage is rounded to a whole number and colour-banded:

- green at 80% or above;
- yellow from 60% through 79%; and
- red below 60%.

The member table exposes individual name, email, grade, selected role, attended
count, denominator, and percentage to the authorized audit actor. Petrios must
not describe the audit system as aggregate-only.

## Per-member attendance PDF

The Report button calls `generateMemberAttendanceReportPDF(userId)`. The action
rebuilds the caller's authorized department scope, loads all past published
sessions in that combined scope, and treats a missing attendance row as
`ABSENT`. `PRESENT` and `LATE` count as attended.

The PDF includes:

- the target profile's name, email, and current profile grade;
- every authorized department name;
- attended/total/rate;
- each session title and start date; and
- derived status plus `attendance.primary_source` when present.

Known source-label mapping covers self check-in, group code, feedback, teacher,
and Teams. Other sources, including Recall, render as their raw enum/string.

**Authorization gap:** the action authorizes the caller's department scope but
does not verify that the supplied target `userId` belongs to any authorized
department. The UI only offers ids from the authorized member list, but a direct
server-action invocation with a known UUID can load that profile and generate a
report against the caller's department sessions. Server-side subject membership
validation is required before this should be considered a closed privacy
boundary.

The report is generated as base64 and is not stored, signed, or logged. Its safe
filename is created only by replacing whitespace in the profile-derived name;
other filename characters are not normalized.

## Equity view

The Equity tab is a pure client-side aggregation over the member rows described
above. No additional anonymization or database query occurs.

Members are grouped by the selected membership grade; null grade becomes
`Unspecified`. For each group:

```text
members        = count(member rows)
attended       = sum(member.sessions_attended)
possible       = sum(member.sessions_total)
attendance_pct = round(100 × attended / possible), or 0 when possible = 0
```

Groups sort from lowest to highest attendance percentage. A cohort with fewer
than five members is labelled “small cohort, interpret with care”, but its exact
member count, attended/possible values, and percentage are still displayed and
exported. This is a warning, not suppression or k-anonymity.

The equity gap is the best minus worst percentage among groups with nonzero
possible sessions. A warning appears at 25 percentage points or more. The UI
suggests that a gap may indicate rota/timing exclusion; it does not establish
causality and does not adjust for department membership, exposure, part-time
status, leave, or expected attendance.

The CSV contains grade, members, sessions attended, sessions possible,
attendance percentage, and small-cohort boolean. It inherits the combined-scope
denominator flaw from member rows.

## Session attendance and Activity Log

The managed-session Attendance tab is the attendance governance surface. It
shows policy version, phase, revision, roster count, present/late/absent/excused
counts, materialized results, evidence source/time, and correction reason. It
supports moderator finalization/reopening and the formula-neutralized attendance
CSV specified in spec 03. Feedback rows never appear as policy-v2 evidence.

The Activity Log reads at most the 100 newest `session_activity_events`, newest
first. The current component displays event type, locale-formatted time, raw
actor user id or `system`, and raw subject user id/external email when present.
It does not currently display the JSON `details`, resolve names, paginate, or
export. Typical new events cover attendance evidence/finalization/reopening,
certificate issuance/reconciliation, teacher feedback report lifecycle, and
session document upload/archive. Teacher feedback attempts distinguish first
release success/failure from explicit resend success/failure. Each completed
attempt stores a unique attempt id, report id, resend flag, and aggregate
sent/failed counts in event details; the current Activity Log displays the event
type but still does not render those JSON details.

The event table is deny-all RLS and read through the service DAL only after the
session-management page establishes moderator authority. It is append-only by
application convention but is not a general security audit: it omits reads,
authentication, many legacy mutations, report downloads, provider dashboard
events, and any action that has not explicitly adopted the event writer.

## Identified session-feedback endpoint

The moderator-only raw feedback action and
`GET /api/sessions/:id/feedback/audit` return every feedback submission newest
first, including first/last name, email, stored rating, normalized answers and
comments, and submission time. This data is separate from Attendance and
Activity Log and must never be described as a confirmed-attendee register.

The older `AuditPanel` browser component can flatten these rows into CSV, but it
is no longer mounted as a managed-session “Attendance Audit” tab. If remounted or
reused, its CSV quotes/doubles embedded quotes but has no server-side export
record, download retention, or complete spreadsheet-formula neutralization.
The recipient is responsible for the resulting identified personal-data file.

## Privacy, interpretation, and governance requirements

- Audit access is access to identifiable education records. Authorization must
  remain server-enforced even when a button is hidden.
- Do not call a mixed/global metric “expected attendance” merely because
  finalized policy-v2 sessions now have a roster. The report must filter to and
  disclose the relevant snapshot/revision rules.
- Do not compare headline and filtered rating values without accounting for
  their response-weighted versus session-weighted formulas.
- Do not use the grade equity table for individual performance evaluation or as
  proof of scheduling discrimination. It is a diagnostic signal over incomplete
  exposure data.
- Small cohorts are not suppressed. Deployments with disclosure-control duties
  need a stronger server-side policy before exporting these values.
- Public certificate codes are intended for verification, but audit access
  makes bulk collection easier; any future code-secret distinction must update
  the register and verification protocol together.
- Exported PDFs and CSVs leave Petrios access controls. They contain no built-in
  revocation, expiry, watermark, or access tracking.

## Change checklist

When changing audit/reporting behavior:

- define actor, organization, departments, subjects, statuses, and time boundary;
- state whether the dataset is complete, limited, paginated, or browser-filtered;
- write the exact numerator, denominator, null handling, weighting, and rounding;
- verify a target member belongs to the authorized scope before a service-role
  profile or attendance read;
- keep UI labels consistent with the actual denominator;
- decide whether multi-department members/sessions should be unioned, intersected,
  or evaluated per department;
- add suppression rules before claiming aggregate privacy;
- treat exports as releases of personal data and test formula/CSV injection where
  inputs are not constrained vocabularies;
- preserve the `lib/db/` boundary and document every service-role query's caller
  authorization obligation; and
- update this file when a limit, filter, metric, role, export field, or report
  failure mode changes.
