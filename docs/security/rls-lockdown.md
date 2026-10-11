# RLS lockdown runbook (migration 062)

This runbook is for the person who applies
`supabase/migrations/062_lock_down_public_rls.sql` to the production Supabase
project in the SQL editor. Read it to the end before you start.

The migration removes anonymous and cross-tenant access through the Supabase
Data API (`/rest/v1`). The public anon key ships to every browser, so until it
is applied anyone on the internet can read or change the data listed in
[section F](#f-what-was-exposed-plain-english-summary).

- **No application deploy is needed for compatibility.** Every path on `main`
  (live on the production Worker) and on the current branch keeps working:
  they use the service role or read the caller's own organisation, and no
  user's own membership rows become more or less visible, so nobody's current
  organisation changes. Deploy the app before or after, in any order.
- **062 does not close everything.** Some holes are in application code, not
  SQL, and stay open until the `lib/auth.ts` follow-up ships. See
  [Still open after 062](#still-open-after-062).
- **062 does not depend on 061.** Production can stay without 061
  (self-hosted setup) and still take 062.
- **Not applied by this repository.** Nothing in CI or the deploy scripts runs
  it. You apply it, then run the post-checks.
- **Never paste the service role key** into anything in this runbook. The curl
  checks use the public anon key only.

## Before you start

1. Confirm a recent backup or point-in-time recovery is available for the
   project (Database → Backups).
2. Pick a quiet time. The migration takes `ACCESS EXCLUSIVE` locks on about a
   dozen busy tables (policy changes, `ENABLE ROW LEVEL SECURITY`), a
   `SHARE ROW EXCLUSIVE` lock on `sessions` and `department_members` for the
   new foreign keys, and a `SHARE` lock on `departments` for the new index. It
   runs in well under a second on a database of this size, but if it waits
   behind a long-running query, every request to a table it has already locked
   queues behind it. Step B sets a lock timeout so that cannot stall the site.
3. Have these ids ready for the post-checks (find them in Authentication →
   Users and the `organizations` / `departments` tables):
   - one ordinary (non-super-admin) moderator account's user id, and the id of
     one organisation that account does **not** belong to;
   - one **org admin** test account (any self-signup account administers its
     own personal workspace, so your own test account works) with its user
     id, the id of an organisation it administers, the id of a department in
     a **different** organisation, and the user id of someone who is **not** a
     member of the administered organisation.

## A. Pre-checks (read-only)

Run these in the SQL editor and keep the output (copy it into the change
record). They change nothing. They tell you whether production matches the
migration files, because the files cannot see edits made in the dashboard.

### A1. RLS state and table owners

```sql
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('session_feedback','teacher_invitations','certificates',
    'organizations','organization_members','departments','department_members',
    'department_join_requests','session_teachers','sessions','attendance',
    'attendance_evidence','profiles')
ORDER BY 1;
```

Expected from the files: every table `rls_enabled = true` **except
`session_feedback` (false)**; `rls_forced = false`; every owner the same role
(normally `postgres`) and the same role you are running the SQL editor as
(`SELECT current_user;`). If the owner differs, stop: the helper functions rely
on running as the table owner.

### A2. Current policies

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('session_feedback','teacher_invitations','certificates',
    'organizations','organization_members','departments','department_members',
    'department_join_requests','session_teachers','attendance',
    'attendance_evidence','profiles')
ORDER BY tablename, policyname;
```

Expected from the files (roles `{public}` for all of these):

| Table | Policies |
|---|---|
| `attendance` | Admins can lock attendance; System can manage computed attendance; Users can view computed attendance |
| `attendance_evidence` | Faculty can create teacher evidence; No updates to evidence; Users can create feedback evidence; Users can create group code evidence; Users can create self check-in evidence; Users can view evidence for accessible sessions |
| `certificates` | Anyone can verify certificates by code; Department admins and org admins can create certificates; Users can view their own certificates |
| `department_join_requests` | Department moderators can update department join requests; Department moderators can view department join requests; Super admins can manage department join requests; Users can create department join requests for themselves; Users can view their own department join requests |
| `department_members` | Org admins can manage department members; Users can view department members in their org |
| `departments` | Authenticated users can view departments; Org admins can create/update/delete departments (3); Super admins can create/update/delete/view departments (4); Users can view departments in their org |
| `organization_members` | Org admins can manage organization members; Super admins can manage organization members; Users can view members of their organizations |
| `organizations` | Authenticated users can view organizations; Org admins can update their organizations; Super admins can create/update/delete organizations (3); Users can create organizations; Users can view organizations they belong to |
| `profiles` | Users can update their own profile; Users can view their own profile |
| `session_feedback` | Anyone can submit feedback for published sessions; Department admins and org admins can view all feedback; Users can view their own feedback |
| `session_teachers` | Department admins and org admins can manage session teachers; Users can view session teachers in their org |
| `teacher_invitations` | Public can read invitation by code; Public can respond to invitation |

**Any policy not in this table is drift.** The migration does not remove
policies it does not know about, and an extra permissive policy keeps a hole
open (policies are OR'ed). Read each extra policy, decide whether it should
exist, and drop it in the same change if not. A missing policy is usually fine
(the migration drops by name with `IF EXISTS`), but note it.

### A3. Table and column grants to the browser roles

```sql
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
  AND table_name IN ('session_feedback','teacher_invitations','certificates',
    'organizations','organization_members','departments','department_members',
    'department_join_requests','session_teachers','attendance',
    'attendance_evidence','profiles')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name IN ('profiles','organization_members')
  AND grantee IN ('anon','authenticated')
  AND privilege_type = 'UPDATE'
ORDER BY table_name, column_name, grantee;
```

Expected on a standard Supabase project: both roles hold every privilege
(DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE) on every
listed table. Keep this output: the rollback in section D restores it.

### A4. Who can execute the sensitive functions

```sql
SELECT p.oid::regprocedure AS function,
       p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS owner,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('record_attendance_evidence_v2','finalize_session_attendance_v2',
    'reopen_session_attendance_v2','rotate_session_group_code_v2',
    'replace_recall_question_set_draft_v1','recall_published_question_set_v1',
    'publish_recall_question_set_v1','record_recall_playback_v1',
    'complete_recall_catchup_v2','claim_ops_newsletter_delivery_v1',
    'generate_group_code','is_department_admin','is_session_faculty',
    'generate_department_code',
    -- created by 062; absent before the first apply
    'is_org_member_of','is_org_admin_of','is_department_moderator_in',
    'is_session_moderator_in','assign_department_code','guard_department_code')
ORDER BY 1;
```

Expected from the files:

- These eleven RPCs show `anon_exec = true` and `authenticated_exec = true`
  (that is the hole), and all but `generate_group_code` (a deterministic
  legacy helper, `security_definer = false`) show `security_definer = true`:
  `claim_ops_newsletter_delivery_v1`, `complete_recall_catchup_v2`,
  `finalize_session_attendance_v2`, `generate_group_code`,
  `publish_recall_question_set_v1`,
  `recall_published_question_set_v1`, `record_attendance_evidence_v2`,
  `record_recall_playback_v1`, `reopen_session_attendance_v2`,
  `replace_recall_question_set_draft_v1`, `rotate_session_group_code_v2`.
  More than one row for the same name is drift (an extra overload); 062
  revokes every overload by name, but note it in the change record.
- `is_department_admin` and `is_session_faculty` show `security_definer =
  true` and an `owner` equal to `SELECT current_user;`. **If the owner
  differs, stop:** section 1 of the migration replaces both, and
  `CREATE OR REPLACE` fails unless you run as their owner (the `BEGIN`/`COMMIT`
  wrapper would roll it back cleanly, but nothing would be applied).
- `generate_department_code` exists with `anon_exec = true` and
  `authenticated_exec = true`.
- The six objects created by 062 (`is_org_member_of`, `is_org_admin_of`,
  `is_department_moderator_in`, `is_session_moderator_in`,
  `assign_department_code`, `guard_department_code`) are absent on a first
  apply.

### A5. Data the new foreign keys will not re-check

```sql
-- Sessions whose department belongs to a different organisation.
-- 062 adds sessions_department_org_fkey as NOT VALID, so these rows stay,
-- but they should not exist; list them in the change record.
SELECT s.id, s.org_id, s.department_id, d.org_id AS department_org_id, s.created_by, s.created_at
FROM public.sessions s
JOIN public.departments d ON d.id = s.department_id
WHERE d.org_id <> s.org_id;

-- Department memberships whose department belongs to a different
-- organisation. These are planted rows (an org admin naming another tenant's
-- department): the reminder cron, slot publications and the finalize roster
-- copy treat their user as a member of that department. 062 adds
-- department_members_department_org_fkey as NOT VALID, so they stay until you
-- delete them (section E4).
SELECT dm.*, d.org_id AS department_org_id
FROM public.department_members dm
JOIN public.departments d ON d.id = dm.department_id
WHERE d.org_id <> dm.org_id;

-- Department moderators with no membership in the department's organisation.
-- These are usually legitimate moderators whose organization_members row is
-- missing; after 062 they lose moderator access through RLS (sessions,
-- feedback, join requests), because is_department_admin now requires that
-- membership. Add the missing organization_members row (service role or SQL
-- editor) before or right after applying, or confirm they should not moderate.
SELECT dm.*
FROM public.department_members dm
WHERE dm.role IN ('org_admin', 'department_admin')
  AND NOT EXISTS (SELECT 1 FROM public.organization_members om
                  WHERE om.org_id = dm.org_id AND om.user_id = dm.user_id);

-- 062 already applied? (all empty on a first apply)
SELECT conname FROM pg_constraint
WHERE conname IN ('sessions_department_org_fkey', 'department_members_department_org_fkey');
SELECT tgname FROM pg_trigger
WHERE tgname IN ('departments_assign_code', 'departments_aa_guard_code') AND NOT tgisinternal;
```

### A6. Whole-schema checks

A1 to A4 only cover the objects 062 touches. These cover the rest of the
schema, because a table or function added by hand in the dashboard is
invisible to the migration files. Keep the output; C1 re-runs them.

```sql
-- 1. Tables in public without RLS. Expected before 062: session_feedback
--    only. Expected after: no rows.
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
ORDER BY 1;

-- 2. Policies that allow everything. Expected before 062:
--    certificates "Anyone can verify certificates by code" and the two
--    teacher_invitations policies (plus any storage policies you set up on
--    purpose). Expected after: none in public.
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND (qual = 'true' OR with_check = 'true')
ORDER BY 1, 2, 3;

-- 3. SECURITY DEFINER functions the browser roles can call.
SELECT p.oid::regprocedure AS function,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND p.prorettype <> 'trigger'::regtype
ORDER BY 1;

-- 4. Views in public (they run with the owner's privileges unless created
--    with security_invoker, so they bypass RLS). Expected from the files: none.
SELECT viewname, viewowner FROM pg_views WHERE schemaname = 'public' ORDER BY 1;

-- 5. Tables published to Realtime (a published table streams rows to
--    subscribers that pass its RLS policies). Expected from the files: none.
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

Expected for query 3 after 062: only helpers that answer a question about the
caller stay executable by `authenticated`: `can_view_session`,
`get_user_org_id`, `is_org_admin`, `is_super_admin`, `is_department_admin`,
`is_session_faculty`, `is_org_member_of`, `is_org_admin_of`,
`is_department_moderator_in`, `is_session_moderator_in`. Of those, only the
four 062 helpers are closed to `anon` (the older ones keep their default grant
and return false for `anon`). Every other row must show `false` for both roles
(on a database with 061, that includes `reserve_instance_setup`,
`complete_instance_setup` and `claim_instance_job`). Anything else, any extra
view, or any published table is drift to review before you continue.

## B. Apply

1. Open the SQL editor and a new query.
2. Type these two lines first:

   ```sql
   BEGIN;
   SET LOCAL lock_timeout = '3s';
   ```

3. Paste the whole of `supabase/migrations/062_lock_down_public_rls.sql`.
4. Type `COMMIT;` on the last line.
5. Run it. A successful run ends with `COMMIT` and no error. If anything
   errors, the transaction is aborted and nothing has changed: run `ROLLBACK;`,
   keep the error text, and stop.
6. If the error is `canceling statement due to lock timeout`, a long-running
   query held one of the tables. Nothing was applied and the site was blocked
   for at most three seconds. Run `ROLLBACK;`, wait a minute, and run the same
   query again. If it keeps timing out, look for the blocker in Database →
   Query performance (or `pg_stat_activity`) before retrying.

Why the extra `BEGIN`/`COMMIT`: the file has none of its own, because
`scripts/migrate.mjs` (self-hosted installs) already wraps each migration in a
transaction. Inside the file, all access removals are in a single `DO` block,
so they apply together or not at all even without the outer transaction.

The migration is idempotent: running it twice is harmless.

If the project tracks migration history with the Supabase CLI, record the
manual apply afterwards (this writes only the history table):
`supabase migration repair --status applied 062`.

## C. Post-checks

### C1. Re-run the pre-checks

Re-run A1 to A6 and compare with this expected state (A5 and A6 as
described there).

- A1: every listed table `rls_enabled = true`, including `session_feedback`.
- A2 (new or changed policies are restricted to `{authenticated}`):

| Table | Policies after 062 |
|---|---|
| `attendance` | System can manage computed attendance; Users can view computed attendance `{authenticated}` |
| `attendance_evidence` | Faculty can create teacher evidence `{authenticated}`; No updates to evidence; Users can create group code evidence; Users can create self check-in evidence; Users can view evidence for accessible sessions `{authenticated}` |
| `certificates` | Department admins and org admins can create certificates `{authenticated}`; Users can view their own certificates `{authenticated}` |
| `department_join_requests` | Department moderators can update department join requests `{authenticated}`; Department moderators can view department join requests `{authenticated}`; Super admins can manage department join requests; Users can view their own department join requests |
| `department_members` | Org admins can delete department members `{authenticated}`; Org admins can insert department members `{authenticated}`; Org admins can update department members `{authenticated}`; Users can view department members in their org |
| `departments` | Org admins can create/update/delete departments (3); Super admins can create/update/delete/view departments (4); Users can view departments in their org `{authenticated}` |
| `organization_members` | Org admins can delete organization members `{authenticated}`; Org admins can update organization members `{authenticated}`; Org admins can view members of administered organizations `{authenticated}`; Org admins can view their own memberships `{authenticated}`; Super admins can manage organization members; Users can view members of their organizations |
| `organizations` | Org admins can update their organizations `{authenticated}`; Super admins can create/update/delete organizations (3); Super admins can view organizations `{authenticated}`; Users can view organizations they belong to `{authenticated}` |
| `profiles` | Users can update their own profile; Users can view their own profile |
| `session_feedback` | Department admins and org admins can view all feedback `{authenticated}`; Super admins can view feedback `{authenticated}`; Users can view their own feedback `{authenticated}` |
| `session_teachers` | Department admins and org admins can manage session teachers `{authenticated}`; Users can view session teachers in their org |
| `teacher_invitations` | (none) |

- A3: `anon` has no privileges on `session_feedback`, `teacher_invitations`,
  `certificates`, `attendance_evidence` or `profiles`, and only `SELECT`,
  `REFERENCES`, `TRIGGER` on the other tables. `authenticated` has nothing on
  `teacher_invitations`; only `SELECT`, `REFERENCES`, `TRIGGER` on
  `session_feedback` and `profiles`, plus column `UPDATE` on `profiles`
  `first_name`, `last_name`, `full_name`, `grade`; no `TRUNCATE` anywhere in
  the list; no `INSERT`/`UPDATE`/`DELETE` on `attendance`; no
  `UPDATE`/`DELETE` on `attendance_evidence`; no table-level `UPDATE` on
  `organization_members` (the column query shows `UPDATE` on `role` only for
  `authenticated`, and nothing for `anon`).
- A4: every row of the eleven RPCs named in A4 (every overload) shows
  `anon_exec = false`, `authenticated_exec = false`, `service_exec = true`.
  The four new helpers (`is_org_member_of`, `is_org_admin_of`,
  `is_department_moderator_in`, `is_session_moderator_in`) show
  `anon_exec = false`, `authenticated_exec = true`. `assign_department_code`,
  `guard_department_code` and `generate_department_code` show
  `anon_exec = false`, `authenticated_exec = false` (the first two run only as
  triggers, which needs no `EXECUTE` grant; the third is no longer used).
  `is_department_admin` and `is_session_faculty` keep their previous grants;
  only their bodies changed.

Anything else is a failed post-check: do not set the flag in section E until
it is explained.

### C2. Simulate the browser roles (rolled back, changes nothing)

Each block runs inside a transaction that ends in `ROLLBACK`. `SET LOCAL ROLE`
makes Postgres apply the same privileges and policies PostgREST applies to a
browser request. Run each block on its own.

**Anonymous visitor.** Expect every count to be `0`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT
  (SELECT count(*) FROM public.organizations)            AS organizations,
  (SELECT count(*) FROM public.organization_members)     AS organization_members,
  (SELECT count(*) FROM public.departments)              AS departments,
  (SELECT count(*) FROM public.department_members)       AS department_members,
  (SELECT count(*) FROM public.department_join_requests) AS department_join_requests,
  (SELECT count(*) FROM public.session_teachers)         AS session_teachers,
  (SELECT count(*) FROM public.attendance)               AS attendance;
ROLLBACK;
```

**Anonymous visitor, revoked tables.** Run each line as its own
`BEGIN; SET LOCAL ROLE anon; <line>; ROLLBACK;`. Expect
`permission denied for table ...` every time.

```sql
SELECT count(*) FROM public.teacher_invitations;
SELECT count(*) FROM public.session_feedback;
SELECT count(*) FROM public.certificates;
SELECT count(*) FROM public.attendance_evidence;
SELECT count(*) FROM public.profiles;
```

**Signed-in user, no cross-tenant rows.** Replace `<USER_ID>` with the
ordinary moderator's id from "Before you start" (not a super admin: super
admins legitimately see every organisation and every feedback row). Expect
every count to be `0`. The `is_*` helpers answer for the simulated caller.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '<USER_ID>', 'role', 'authenticated')::text, true);
SELECT
  (SELECT count(*) FROM public.organizations o
     WHERE NOT public.is_org_member_of(o.id))                         AS foreign_organizations,
  (SELECT count(*) FROM public.organization_members m
     WHERE NOT public.is_org_member_of(m.org_id))                     AS foreign_memberships,
  (SELECT count(*) FROM public.departments d
     WHERE NOT public.is_org_member_of(d.org_id))                     AS foreign_departments,
  (SELECT count(*) FROM public.certificates c
     WHERE c.user_id IS DISTINCT FROM auth.uid()
       AND NOT public.is_org_member_of(c.org_id))                     AS foreign_certificates,
  (SELECT count(*) FROM public.session_feedback f
     WHERE NOT public.is_org_member_of(f.org_id))                     AS foreign_feedback,
  (SELECT count(*) FROM public.department_join_requests r
     WHERE r.user_id <> auth.uid()
       AND NOT public.is_org_member_of(r.org_id))                     AS foreign_join_requests,
  (SELECT count(*) FROM public.session_teachers t
     WHERE NOT public.is_org_member_of(t.org_id))                     AS foreign_session_teachers,
  (SELECT count(*) FROM public.department_members dm
     WHERE NOT public.is_org_member_of(dm.org_id))                    AS foreign_department_members,
  (SELECT count(*) FROM public.attendance a
     WHERE a.user_id IS DISTINCT FROM auth.uid()
       AND NOT public.is_org_member_of(a.org_id))                     AS foreign_attendance,
  (SELECT count(*) FROM public.attendance_evidence e
     WHERE e.user_id IS DISTINCT FROM auth.uid()
       AND NOT public.is_org_member_of(e.org_id))                     AS foreign_evidence;
ROLLBACK;
```

**Signed-in user, blocked writes.** Run each statement in its own block:
`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub', '<USER_ID>', 'role', 'authenticated')::text, true); <statement>; ROLLBACK;`
Replace `<FOREIGN_ORG_ID>` with the organisation the user does not belong to.

| Statement | Expected result |
|---|---|
| `INSERT INTO public.organization_members (org_id, user_id, role) VALUES ('<FOREIGN_ORG_ID>', '<USER_ID>', 'org_admin');` | `new row violates row-level security policy` |
| `UPDATE public.organizations SET name = name WHERE id = '<FOREIGN_ORG_ID>';` | `UPDATE 0` |
| `INSERT INTO public.organizations (name, created_by) VALUES ('rls-check', '<USER_ID>');` | `new row violates row-level security policy` |
| `SELECT count(*) FROM public.teacher_invitations;` | `permission denied for table teacher_invitations` |
| `UPDATE public.profiles SET email = email WHERE user_id = auth.uid();` | `permission denied for table profiles` |
| `UPDATE public.profiles SET full_name = full_name WHERE user_id = auth.uid();` | `UPDATE 1` (display names stay self-editable) |
| `UPDATE public.attendance SET status = status WHERE false;` | `permission denied for table attendance` |

**Org admin, blocked writes.** Same pattern, but with the org admin test
account from "Before you start": `<ADMIN_ID>` (its user id), `<OWN_ORG>` (an
organisation it administers and its first membership, for example its
personal workspace), `<FOREIGN_DEPT>` (a department in a different
organisation) and `<NON_MEMBER_ID>` (a user who is not a member of
`<OWN_ORG>`).

| Statement | Expected result |
|---|---|
| `INSERT INTO public.department_members (org_id, department_id, user_id, role) VALUES ('<OWN_ORG>', '<FOREIGN_DEPT>', '<ADMIN_ID>', 'trainee');` | `new row violates row-level security policy for table "department_members"` |
| `INSERT INTO public.organization_members (org_id, user_id, role) VALUES ('<OWN_ORG>', '<NON_MEMBER_ID>', 'trainee');` | `new row violates row-level security policy for table "organization_members"` |
| `UPDATE public.organization_members SET user_id = user_id WHERE org_id = '<OWN_ORG>';` | `permission denied for table organization_members` (only `role` is updatable) |
| `UPDATE public.departments SET department_code = '000000' WHERE org_id = '<OWN_ORG>';` | `department_code is server-assigned` (if a department there already has code `000000`, pick any other value) |
| `INSERT INTO public.departments (org_id, name, created_by, department_code) VALUES ('<OWN_ORG>', 'rls-check', '<ADMIN_ID>', '<A_CODE_IN_USE>') RETURNING department_code;` | One row whose `department_code` is a **different**, freshly drawn 6-digit code (the supplied one is discarded); use the code of one of the account's own departments as `<A_CODE_IN_USE>` |

Do **not** call the attendance, Recall or newsletter RPCs to test them. A4's
`has_function_privilege` result is the check; a real call would act on data if
the revoke had failed.

### C3. From outside, with the public anon key (optional)

Run these from your own machine. Paste the anon key yourself (Project Settings
→ API → `anon` `public`); never the `service_role` key.

```bash
SUPABASE_URL="https://<project-ref>.supabase.co"
read -r ANON_KEY   # paste the anon key, press Enter

for t in teacher_invitations session_feedback certificates profiles; do
  printf '%s: ' "$t"
  curl -s -o /dev/null -w '%{http_code}\n' \
    "$SUPABASE_URL/rest/v1/$t?limit=1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
done
# Expect 401 for each (PostgREST reports "permission denied" to anon as 401).
# No select= column list: profiles has no id column, and a missing column
# answers 400 whatever the privileges.

for t in organizations departments organization_members; do
  printf '%s: ' "$t"
  curl -s "$SUPABASE_URL/rest/v1/$t?limit=1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"; echo
done
# Expect [] for each.

# A harmless RPC probe: the all-zero id matches no delivery, so even an
# unrevoked function would change nothing.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$SUPABASE_URL/rest/v1/rpc/claim_ops_newsletter_delivery_v1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_delivery_id":"00000000-0000-0000-0000-000000000000"}'
# Expect 401 (permission denied for function). 404 also means the browser
# roles cannot call it. 200 means the revoke did not apply.
```

### C4. Application smoke test (production, real accounts)

With an ordinary moderator account:

- Dashboard loads with the department list.
- A session's Feedback tab shows its responses and stats; the AI summary does
  not say "No feedback has been submitted yet" for a session that has feedback.
- Add, then remove, a registered teacher on a draft session.
- Download one of your own certificates; open `/verify/<code>` signed out.
- Create a department (Settings) and check it gets a 6-digit code.
- Open a department's member list: the same members as before.
- Sign in as an account that belongs to more than one organisation (if you
  have one): the dashboard opens in the same organisation as before. 062 must
  not change anyone's current organisation.

As a visitor (signed out): submit public feedback on an open session; open a
teacher RSVP link. As a super admin (if you have one): the organisations list
on the super-admin page shows every organisation.

## D. Rollback

Prefer a forward fix: every legitimate path was checked against 062, and
rolling back re-opens the exposures in section F. Sections 2.1 to 2.3 of the
migration (`session_feedback`, `teacher_invitations`, the RPC revokes) have no
application dependency at all; **do not roll those back.**

If a specific screen breaks, restore only the matching block below. To undo the
whole migration, run every block in order inside `BEGIN; ... COMMIT;`. The
`GRANT ALL` lines restore Supabase's default grants; if A3 showed something
narrower before you applied 062, restore what A3 showed instead.

```sql
-- organization_members
DROP POLICY IF EXISTS "Org admins can manage organization members" ON public.organization_members;
DROP POLICY IF EXISTS "Org admins can view members of administered organizations" ON public.organization_members;
DROP POLICY IF EXISTS "Org admins can update organization members" ON public.organization_members;
DROP POLICY IF EXISTS "Org admins can delete organization members" ON public.organization_members;
DROP POLICY IF EXISTS "Org admins can view their own memberships" ON public.organization_members;
CREATE POLICY "Org admins can manage organization members"
  ON public.organization_members FOR ALL
  USING (is_org_admin()) WITH CHECK (is_org_admin());
GRANT ALL ON public.organization_members TO anon, authenticated;

-- department_members
DROP POLICY IF EXISTS "Org admins can insert department members" ON public.department_members;
DROP POLICY IF EXISTS "Org admins can update department members" ON public.department_members;
DROP POLICY IF EXISTS "Org admins can delete department members" ON public.department_members;
DROP POLICY IF EXISTS "Org admins can manage department members" ON public.department_members;
CREATE POLICY "Org admins can manage department members"
  ON public.department_members FOR ALL
  USING (org_id = get_user_org_id() AND is_org_admin())
  WITH CHECK (org_id = get_user_org_id() AND is_org_admin());
ALTER TABLE public.department_members DROP CONSTRAINT IF EXISTS department_members_department_org_fkey;
GRANT ALL ON public.department_members TO anon, authenticated;

-- organizations
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON public.organizations;
DROP POLICY IF EXISTS "Super admins can view organizations" ON public.organizations;
DROP POLICY IF EXISTS "Org admins can update their organizations" ON public.organizations;
CREATE POLICY "Users can view organizations they belong to"
  ON public.organizations FOR SELECT
  USING (id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));
CREATE POLICY "Users can create organizations"
  ON public.organizations FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "Org admins can update their organizations"
  ON public.organizations FOR UPDATE USING (is_org_admin());
CREATE POLICY "Authenticated users can view organizations"
  ON public.organizations FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT ALL ON public.organizations TO anon, authenticated;

-- departments (department codes, session/department foreign key)
DROP POLICY IF EXISTS "Users can view departments in their org" ON public.departments;
CREATE POLICY "Users can view departments in their org"
  ON public.departments FOR SELECT USING (org_id = get_user_org_id());
CREATE POLICY "Authenticated users can view departments"
  ON public.departments FOR SELECT USING (auth.uid() IS NOT NULL);
DROP TRIGGER IF EXISTS departments_aa_guard_code ON public.departments;
DROP TRIGGER IF EXISTS departments_assign_code ON public.departments;
-- The DEFAULT runs as the inserting role, so it needs EXECUTE back.
GRANT EXECUTE ON FUNCTION public.generate_department_code() TO PUBLIC, anon, authenticated;
ALTER TABLE public.departments ALTER COLUMN department_code SET DEFAULT public.generate_department_code();
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_department_org_fkey;
-- Both composite foreign keys depend on the index; drop them first.
ALTER TABLE public.department_members DROP CONSTRAINT IF EXISTS department_members_department_org_fkey;
DROP INDEX IF EXISTS public.departments_id_org_id_key;
GRANT ALL ON public.departments TO anon, authenticated;

-- department_join_requests
DROP POLICY IF EXISTS "Department moderators can view department join requests" ON public.department_join_requests;
DROP POLICY IF EXISTS "Department moderators can update department join requests" ON public.department_join_requests;
CREATE POLICY "Department moderators can view department join requests"
  ON public.department_join_requests FOR SELECT USING (is_department_admin(department_id));
CREATE POLICY "Department moderators can update department join requests"
  ON public.department_join_requests FOR UPDATE
  USING (is_department_admin(department_id)) WITH CHECK (is_department_admin(department_id));
CREATE POLICY "Users can create department join requests for themselves"
  ON public.department_join_requests FOR INSERT
  WITH CHECK (user_id = auth.uid() AND status = 'PENDING');
GRANT ALL ON public.department_join_requests TO anon, authenticated;

-- session_teachers
DROP POLICY IF EXISTS "Department admins and org admins can manage session teachers" ON public.session_teachers;
CREATE POLICY "Department admins and org admins can manage session teachers"
  ON public.session_teachers FOR ALL
  USING (org_id = get_user_org_id() AND (is_org_admin() OR EXISTS (
    SELECT 1 FROM sessions s WHERE s.id = session_teachers.session_id AND is_department_admin(s.department_id))))
  WITH CHECK (org_id = get_user_org_id() AND (is_org_admin() OR EXISTS (
    SELECT 1 FROM sessions s WHERE s.id = session_teachers.session_id AND is_department_admin(s.department_id))));
GRANT ALL ON public.session_teachers TO anon, authenticated;

-- certificates (re-adding "Anyone can verify certificates by code" re-exposes
-- every certificate; it is deliberately left out. Public verification does not
-- need it.)
DROP POLICY IF EXISTS "Users can view their own certificates" ON public.certificates;
DROP POLICY IF EXISTS "Department admins and org admins can create certificates" ON public.certificates;
CREATE POLICY "Users can view their own certificates"
  ON public.certificates FOR SELECT
  USING (org_id = get_user_org_id() AND (user_id = auth.uid() OR is_org_admin() OR is_department_admin(department_id)));
CREATE POLICY "Department admins and org admins can create certificates"
  ON public.certificates FOR INSERT
  WITH CHECK (org_id = get_user_org_id() AND (is_org_admin() OR is_department_admin(department_id)));
GRANT TRUNCATE ON public.certificates TO authenticated;

-- attendance / attendance_evidence / profiles: grants only (the dropped
-- policies were the holes; nothing in the app needs them)
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance TO authenticated;
GRANT UPDATE, DELETE, TRUNCATE ON public.attendance_evidence TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles TO authenticated;

-- attendance / attendance_evidence read and TEACHER-insert policies: the
-- 015/049 versions (unscoped is_org_admin(); re-opens cross-tenant reads for
-- admins who also belong to another organisation).
DROP POLICY IF EXISTS "Users can view computed attendance" ON public.attendance;
CREATE POLICY "Users can view computed attendance"
  ON public.attendance FOR SELECT
  USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid())
    AND (user_id = auth.uid() OR is_org_admin() OR EXISTS (
      SELECT 1 FROM sessions s WHERE s.id = attendance.session_id
        AND (is_department_admin(s.department_id) OR EXISTS (
          SELECT 1 FROM session_teachers st WHERE st.session_id = s.id AND st.user_id = auth.uid())))));
DROP POLICY IF EXISTS "Users can view evidence for accessible sessions" ON public.attendance_evidence;
CREATE POLICY "Users can view evidence for accessible sessions"
  ON public.attendance_evidence FOR SELECT
  USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid())
    AND (user_id = auth.uid() OR is_org_admin() OR EXISTS (
      SELECT 1 FROM sessions s WHERE s.id = attendance_evidence.session_id
        AND (is_department_admin(s.department_id) OR EXISTS (
          SELECT 1 FROM session_teachers st WHERE st.session_id = s.id AND st.user_id = auth.uid())))));
DROP POLICY IF EXISTS "Faculty can create teacher evidence" ON public.attendance_evidence;
CREATE POLICY "Faculty can create teacher evidence"
  ON public.attendance_evidence FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM public.organization_members WHERE user_id = auth.uid())
    AND source = 'TEACHER'
    AND EXISTS (SELECT 1 FROM public.sessions s
      WHERE s.id = attendance_evidence.session_id
        AND s.org_id = attendance_evidence.org_id
        AND s.department_id = attendance_evidence.department_id
        AND s.attendance_policy_version = 1
        AND (is_org_admin() OR is_department_admin(s.department_id) OR EXISTS (
          SELECT 1 FROM public.session_teachers st
          WHERE st.session_id = s.id AND st.user_id = auth.uid()))));

-- Helper functions: restore the 004 bodies of the two narrowed helpers, then
-- drop the two trigger functions (the four is_* helpers stay; see below).
CREATE OR REPLACE FUNCTION public.is_department_admin(dept_id UUID)
RETURNS BOOLEAN AS $$
DECLARE user_org_id UUID;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  user_org_id := get_user_org_id();
  RETURN EXISTS (
    SELECT 1 FROM department_members
    WHERE org_id = user_org_id AND department_id = dept_id
      AND user_id = auth.uid() AND role IN ('org_admin', 'department_admin')
  ) OR is_org_admin();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_session_faculty(sess_id UUID)
RETURNS BOOLEAN AS $$
DECLARE user_org_id UUID;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  user_org_id := get_user_org_id();
  RETURN EXISTS (
    SELECT 1 FROM session_teachers
    WHERE org_id = user_org_id AND session_id = sess_id AND user_id = auth.uid()
  ) OR is_org_admin() OR EXISTS (
    SELECT 1 FROM sessions s
    JOIN department_members dm ON s.department_id = dm.department_id
    WHERE s.id = sess_id AND s.org_id = user_org_id
      AND dm.user_id = auth.uid() AND dm.role IN ('org_admin', 'department_admin')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- The departments block above dropped the triggers that used these functions.
DROP FUNCTION IF EXISTS public.guard_department_code();
DROP FUNCTION IF EXISTS public.assign_department_code();
```

Leave the four `is_*` helpers in place even after a full rollback: the
`session_feedback` policies use them, and they only answer questions about the
caller.

## E. After applying

1. **Decide about invite codes first.** Once the flag in step 2 is on, an
   ACCEPTED invite code unlocks a moderator room pass for its session. The
   table was readable by anyone since migration 017, so any code issued before
   062 may have been copied. For sessions that have not ended yet, list the
   invitations and have the moderator delete and re-invite the teacher in the
   app (this emails a fresh link; there is no resend action):

   ```sql
   SELECT ti.id, ti.org_id, ti.session_id, s.title, s.date_start, ti.email, ti.status
   FROM public.teacher_invitations ti
   JOIN public.sessions s ON s.id = ti.session_id
   WHERE s.date_end > now() AND ti.status IN ('PENDING', 'ACCEPTED')
   ORDER BY s.date_start;
   ```

2. **Turn on the external-teacher capability on the branch build.** Set
   `TEACHER_INVITATIONS_RLS_LOCKED=true` on every deployment running the branch
   code (the Worker secret on the production and staging Workers, as in
   `docs/cloudflare-workers.md`; the environment on Docker/self-hosting), then
   redeploy or restart. See `lib/teacher-invitation-capability.ts`. The code on `main` does not read the
   flag; setting it there is harmless. Do this only after C1 to C3 pass and step 1 is done.
3. **Rotate department codes (required, or record the risk acceptance).**
   Since migrations 012/022 every signed-in user could read every
   department's 6-digit join code, and a code joins a signed-in user to that
   department without approval. 062 stops new reads and code probing, but it
   cannot un-leak codes already copied, and the old codes came from
   `RANDOM()`, which is not a secure random source. Either rotate, or write in
   the change record who accepted the risk of keeping the current codes and
   why. Rotating invalidates codes already on posters, QR codes and emails, so
   tell moderators first. Run it in the SQL editor (as the owner, which the
   062 guard allows; browser roles cannot change codes). Rotate row by row so
   two departments cannot draw the same new code; the generator is the same
   as 062's trigger:

   ```sql
   DO $$
   DECLARE r RECORD; v TEXT;
   BEGIN
     FOR r IN SELECT id FROM public.departments LOOP
       LOOP
         v := LPAD(
           ((('x' || LPAD(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8), 16, '0'))::BIT(64)::BIGINT
             % 1000000))::TEXT,
           6, '0');
         EXIT WHEN NOT EXISTS (SELECT 1 FROM public.departments WHERE department_code = v);
       END LOOP;
       UPDATE public.departments SET department_code = v WHERE id = r.id;
     END LOOP;
   END $$;
   ```

4. **Look for signs of misuse (read-only).** None of these prove abuse on
   their own; they list rows to review with the organisation concerned.

   ```sql
   -- Users who are org_admin of more than one organisation.
   SELECT user_id, array_agg(org_id ORDER BY created_at) AS orgs, array_agg(created_at ORDER BY created_at) AS since
   FROM public.organization_members WHERE role = 'org_admin'
   GROUP BY user_id HAVING count(*) > 1;

   -- Teacher assignments whose organisation is not the session's.
   SELECT st.* FROM public.session_teachers st
   JOIN public.sessions s ON s.id = st.session_id
   WHERE st.org_id <> s.org_id;

   -- Department memberships naming another organisation's department (planted
   -- rows; same query as A5). Review each with the department's organisation,
   -- then delete it in the SQL editor:
   --   DELETE FROM public.department_members WHERE id = '<row id>';
   SELECT dm.*, d.org_id AS department_org_id
   FROM public.department_members dm
   JOIN public.departments d ON d.id = dm.department_id
   WHERE d.org_id <> dm.org_id;

   -- Moderators with no membership in the department's organisation (same
   -- query as A5). Legitimate ones need their organization_members row
   -- restored; 062 removed their moderator access through RLS.
   SELECT dm.*
   FROM public.department_members dm
   WHERE dm.role IN ('org_admin', 'department_admin')
     AND NOT EXISTS (SELECT 1 FROM public.organization_members om
                     WHERE om.org_id = dm.org_id AND om.user_id = dm.user_id);

   -- Members of someone else's personal workspace. A personal workspace has
   -- only its owner, so another member was most likely added directly through
   -- the Data API (before 062 any org admin could add any user to their own
   -- organisation, which can switch that user's current organisation).
   SELECT om.*, o.created_by AS workspace_owner
   FROM public.organization_members om
   JOIN public.organizations o ON o.id = om.org_id
   WHERE o.is_personal AND om.user_id <> o.created_by;

   -- Join requests naming a department outside their organisation, or asking for an admin role.
   SELECT r.* FROM public.department_join_requests r
   JOIN public.departments d ON d.id = r.department_id
   WHERE d.org_id <> r.org_id OR r.requested_role IN ('org_admin', 'department_admin');

   -- Profiles whose email no longer matches the sign-in email.
   SELECT p.user_id, p.email AS profile_email, u.email AS auth_email
   FROM public.profiles p JOIN auth.users u ON u.id = p.user_id
   WHERE lower(p.email) IS DISTINCT FROM lower(u.email);

   -- FEEDBACK attendance evidence (the product no longer creates any).
   SELECT * FROM public.attendance_evidence WHERE source = 'FEEDBACK' ORDER BY created_at DESC LIMIT 100;

   -- Finalize/reopen/evidence events whose actor does not moderate the department.
   SELECT e.* FROM public.session_activity_events e
   WHERE e.event_type IN ('ATTENDANCE_FINALIZED', 'ATTENDANCE_REOPENED', 'ATTENDANCE_EVIDENCE_RECORDED')
     AND e.actor_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.organization_members om
       WHERE om.org_id = e.org_id AND om.user_id = e.actor_user_id AND om.role = 'org_admin')
     AND NOT EXISTS (SELECT 1 FROM public.department_members dm
       WHERE dm.department_id = e.department_id AND dm.user_id = e.actor_user_id
         AND dm.role IN ('org_admin', 'department_admin'))
   ORDER BY e.created_at DESC;

   -- Accepted external invitations whose email is not in the organisation's address book
   -- (the address book captures the email the moderator typed).
   SELECT ti.* FROM public.teacher_invitations ti
   WHERE ti.status = 'ACCEPTED'
     AND NOT EXISTS (SELECT 1 FROM public.external_contacts c
       WHERE c.org_id = ti.org_id AND lower(c.email) = lower(ti.email));

   -- Feedback rows without a submission key (the app has set one since migration 048).
   SELECT id, org_id, session_id, created_at FROM public.session_feedback
   WHERE submission_key IS NULL ORDER BY created_at DESC LIMIT 100;
   ```

5. **Check the API logs while they still exist.** In the dashboard (Logs →
   API / PostgREST), filter for requests to `/rest/v1/teacher_invitations`,
   `/rest/v1/session_feedback`, `/rest/v1/certificates`,
   `/rest/v1/departments`, `/rest/v1/organizations`,
   `/rest/v1/organization_members` and `/rest/v1/rpc/` that did not come from
   the application's servers (the production and staging Workers on
   Cloudflare, and before 2026-10-11 Render). The app never calls these tables
   or RPCs from the browser, so any browser-origin request to them is worth
   reviewing. Log retention depends on the plan; save what you find to the
   change record.

## F. What was exposed (plain-English summary)

For the data controller's data-protection assessment. "Anyone" means anyone
with the public anon key, which every visitor's browser downloads. "Any
signed-in user" means anyone who signed up for an account. "Any organisation
admin" means an administrator of some other organisation on the same Petrios
instance; every self-signup account administers its own personal workspace, so
in practice this also means any signed-in user. All of these existed from the migration that introduced each
table or policy until 062 is applied; the files cannot say whether anyone used
them (see E5).

**Personal data that could be read**

- *Anyone:* every feedback response in every organisation: respondent's first
  and last name, email, free-text comment and structured answers (which can
  include welfare or wellbeing disclosures), rating and session.
- *Anyone:* every external-teacher invitation: teacher's email, name, invite
  code, status, session and organisation.
- *Anyone:* every certificate: recipient name and email, issuer name,
  coordinator names, session, status and revocation reason, and whether
  recognition came from live attendance or Audio Recap catch-up.
- *Any signed-in user:* every organisation's name and creator id (personal
  workspaces are named after their owner) and every department's details,
  including its join code and the teaching lead's stored signature image.
- *Any organisation admin:* the membership list (user ids and roles) of every
  organisation, and every department join request (requester email, role,
  status) in every organisation.
- *An organisation admin who was also an ordinary member of another
  organisation:* that organisation's attendance results and attendance
  evidence.

**Data that could be changed or created**

- *Anyone:* feedback could be inserted, edited or deleted, which corrupts
  teacher feedback reports and appraisal evidence.
- *Anyone:* an invitation could be marked accepted under a different email,
  making that person an expected teacher and eligible for a teaching
  certificate emailed to them.
- *Anyone:* attendance could be recorded, finalised or reopened for any
  session (reopening revokes that session's certificates), group check-in codes
  replaced, Audio Recap questions and listening progress altered, and newsletter
  deliveries claimed.
- *Any organisation admin:* could make themselves administrator of any other
  organisation, rename any organisation, attach themselves as a teacher of
  another organisation's session (receiving its reminders, feedback report and a
  teaching certificate), and point one of their sessions at another
  organisation's department to copy its member list.
- *Any organisation admin:* could add themselves to another organisation's
  department without that organisation seeing it. They would then receive its
  session reminders (with meeting links), appear in its teaching-slot
  publications, and be copied into its attendance rosters as an expected
  attendee, which leads to Audio Recap catch-up invitations, the private recap
  and a catch-up certificate.
- *Any organisation admin:* could add any user to their own organisation,
  which can switch that user's current organisation in the app, and, with a
  department moderator role there, demote the user's moderator roles in their
  real organisation (migration 044 allows one moderator organisation per user).
- *Any organisation admin:* could learn which department join codes are in use
  by trying to create or rename departments with chosen codes.
- *Any signed-in user:* could change the email on their own profile to someone
  else's unregistered address, which some server lookups trust as identity.
- *A session teacher (any RSVP status) or organisation admin within an
  organisation:* could rewrite final attendance results directly.

Encrypted secrets were not exposed: group check-in codes are stored only as
salted verifiers, API tokens are hashed, and the service role key is never sent
to browsers. Session documents, Audio Recap audio and Ops data are in tables
and storage with deny-all access and were not affected.

### Still open after 062

These are not closed by the migration. Record them in the change record.

- **Moderator check in application code.** `isDepartmentModerator()` in
  `lib/auth.ts` treats an org admin of the caller's current organisation as
  moderator of every department, in every organisation. Server actions gated
  by it then use the service role, which RLS cannot restrict. For example,
  `getDepartmentMemberUsers` (`app/actions/departments.ts`) returns the member
  user ids and emails of whatever department id it is given, so invoked
  directly as a Server Action with another organisation's department id it
  still leaks that department's member emails to any org admin (any
  self-signup user). This stays open until the `lib/auth.ts` follow-up ships
  (check the department's organisation before granting moderator rights).
- **Join-request approval.** `approveDepartmentJoinRequest` trusts the
  request's `org_id` and a client-chosen role. 062 removes the self-insert
  policy, so no new requests can be filed directly, and the new
  `department_members` foreign key rejects the department row for a request
  whose department belongs to another organisation (the organisation
  membership the action upserts first is still written). Requests filed
  before 062 are listed in E4; reject or delete the suspicious ones before
  anyone approves them.
- **Rows created before 062.** Planted department memberships, injected
  organisation memberships and cross-tenant teacher assignments stay until you
  delete them (E4); the `NOT VALID` foreign keys only check new rows.
- **Copied codes.** Department join codes and invite codes read before 062
  stay valid until rotated (E1, E3).
