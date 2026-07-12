# Evidence-Based Attendance System

## Overview

The attendance system uses an **evidence aggregation pipeline** approach where attendance is computed from multiple immutable evidence sources rather than being a single event.

## RECALL source (Petrios Recall catch-up — added in migration 039)

`RECALL` is a sixth evidence source: an absentee who passes the session's
recall questions (2 of 3, within 21 days of session end) earns attendance.
It has the LOWEST priority (0) so it never outranks real presence, carries
`metadata.status_override='PRESENT'` (a post-session timestamp must not read
as LATE), and remains visible as `primary_source` in every audit/portfolio
surface as "Caught up". Full flow: spec/08-portfolio-and-recall.md.

## Architecture

### Core Concepts

1. **Evidence Sources**: Multiple ways to prove attendance
   - `SELF_CHECKIN`: User clicks check-in button
   - `GROUP_CODE`: User checks in using a group code/QR
   - `FEEDBACK`: Feedback submission (if user is department member)
   - `TEACHER`: Teacher/admin manually confirms
   - `TEAMS`: Placeholder for future Microsoft Teams import

2. **Evidence Table** (`attendance_evidence`): Append-only audit trail
   - Stores all evidence with metadata
   - Immutable (no updates/deletes except org_admin)
   - Includes timestamps, source, user info, and metadata

3. **Computed Attendance** (`attendance`): Materialized view
   - Derived from evidence using deterministic rules
   - Can be locked to prevent recomputation
   - Includes primary source and first evidence timestamp

## Database Schema

### Sessions Table (Updated)
- `attendance_mode`: 'SELF_CHECKIN' | 'EVIDENCE_AGGREGATION' (default: EVIDENCE_AGGREGATION)
- `checkin_open_mins_before`: Default 15
- `checkin_close_mins_after`: Default 45
- `feedback_valid_mins_after_end`: Default 120
- `late_after_mins`: Default 10
- `require_feedback_for_certificate`: Boolean (default: false)
- `group_code_enabled`: Boolean (default: true)
- `group_code_version`: Integer (increments on regenerate)
- `group_code_expires_at`: Timestamp
- `attendance_locked`: Boolean
- `attendance_locked_at`: Timestamp
- `attendance_locked_by`: User ID

### Attendance Evidence Table (New)
- `id`, `org_id`, `session_id`, `department_id`
- `user_id`: Nullable (for anonymous/external)
- `external_email`: Nullable
- `source`: Evidence source enum
- `observed_at`: When evidence was created
- `metadata`: JSONB (stores code_version, feedback_id, etc.)
- `created_at`, `created_by`

### Attendance Table (Updated)
- Now computed/materialized from evidence
- `primary_source`: Which evidence source determined status
- `first_evidence_at`: Timestamp of first valid evidence
- `computed_at`: When attendance was last computed
- `locked`: Boolean (prevents recomputation)
- `locked_by`, `locked_at`

## Evidence Validation Rules

### Time Windows
- **SELF_CHECKIN / GROUP_CODE**: Valid from `session_start - checkin_open_mins_before` to `session_start + checkin_close_mins_after`
- **FEEDBACK**: Valid from `session_start - checkin_open_mins_before` to `session_end + feedback_valid_mins_after_end`
- **TEACHER / TEAMS**: Always valid (created by authorized users)

### Balanced Mode (Implemented)
FEEDBACK implies presence if:
1. User is authenticated
2. User is a department member
3. Feedback submitted within valid time window

### Priority Order
When multiple evidence exists, highest priority wins:
1. TEACHER (highest)
2. TEAMS
3. FEEDBACK
4. GROUP_CODE
5. SELF_CHECKIN (lowest)

## Group Code System

- Teachers/admins can generate group codes for sessions
- Code is deterministic (generated from session ID + version)
- Version increments on regenerate
- Expires at `session_end + checkin_close_mins_after`
- QR code links to `/sessions/{id}/checkin?v={version}`
- Users can check in via code or QR scan

## Locking Mechanism

- Moderators can lock attendance after session ends
- When locked:
  - No automatic recomputation
  - Evidence can still be added (for audit)
  - Manual adjustments require unlock
- Locking sets `attendance_locked` on session and all attendance records

## Certificate Eligibility

Certificates generated for:
- **Attendees**: Status is PRESENT or LATE AND session ended AND session not CANCELLED
- **Optional**: If `require_feedback_for_certificate` is true, feedback evidence must exist
- **Teachers**: After session ends

## Server Actions

### `addEvidence(sessionId, source, payload)`
- Validates permissions per source
- Validates time windows
- Inserts evidence
- Triggers recomputation if not locked

### `recomputeAttendance(sessionId, userId, externalEmail)`
- Fetches all evidence for user
- Filters to valid evidence (time windows)
- Determines status, primary source, first evidence
- Upserts computed attendance

### `lockAttendance(sessionId)` / `unlockAttendance(sessionId)`
- Locks/unlocks session and all attendance records
- Requires moderator permissions

### `generateGroupCode(sessionId)`
- Increments version
- Sets expiry
- Returns deterministic code

## UI Components

- **GroupCodeDisplay**: Shows code, QR, and generation controls (moderators)
- **GroupCodeCheckIn**: Form to enter group code
- **AttendanceTrackingPanel**: View attendance with evidence drilldown, lock/unlock
- **CheckInButton**: Standard self check-in

## Migration Notes

Run migrations in order:
1. `014_evidence_based_attendance.sql` - Schema changes
2. `015_attendance_evidence_rls.sql` - RLS policies

The system maintains backward compatibility - existing attendance records will work, but new ones use the evidence system.
