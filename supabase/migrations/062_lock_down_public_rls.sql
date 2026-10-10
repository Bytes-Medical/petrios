-- 062: Lock down public and cross-tenant access through the Supabase Data API.
--
-- Runbook (pre-checks, apply, post-checks, rollback): docs/security/rls-lockdown.md
--
-- What this closes (all confirmed against migrations 000-061; production may
-- have drifted, so run the runbook pre-checks first):
--   1. session_feedback never had RLS enabled (013), so the anon key could
--      read, insert, update and delete every identified feedback response.
--   2. teacher_invitations had SELECT USING (true) and UPDATE USING (true)
--      policies for PUBLIC (017): anyone could list invite codes or accept an
--      invitation as themselves.
--   3. SECURITY DEFINER RPCs (attendance v2, group-code rotation, Recall,
--      newsletter claim) were revoked only FROM PUBLIC. Supabase grants
--      EXECUTE to anon and authenticated directly, so those grants survived.
--   4. Cross-tenant RLS: helpers is_org_admin() and is_department_admin() check
--      the caller's own first organisation, not the row's organisation, so any
--      org admin could manage other tenants' memberships, organisations, join
--      requests and session teachers, and read other tenants' attendance and
--      evidence in any organisation they also belonged to.
--   5. Broad SELECT policies: certificates USING (true), every department
--      (including the 6-digit join code and the lead's signature image) and
--      every organisation to any signed-in user.
--   6. Planted rows: an org admin (every self-signup user administers their
--      personal workspace) could add department_members rows naming another
--      tenant's department (picked up by reminders, slot publications and the
--      finalize roster copy), add any user to their own organisation (which
--      can switch that user's current organisation in the app), and supply or
--      change department codes to learn by collision which codes are in use.
--   7. Smaller gaps: profiles identity columns writable by their owner, direct
--      UPDATE of computed attendance by teachers, anonymous FEEDBACK evidence
--      inserts, sessions pointing at another tenant's department.
--
-- Compatibility: every application path on main (live on Render) and on the
-- current branch already reads and writes these tables either through the
-- service role or through the RLS client for the caller's OWN organisation.
-- The replacement policies use membership-based helpers (any organisation the
-- caller actually belongs to) instead of get_user_org_id() (an arbitrary
-- LIMIT 1 pick), so users with more than one membership keep the access the
-- old over-broad policies happened to give them inside their own tenants.
-- Visibility of a user's OWN organization_members / department_members rows
-- is deliberately unchanged: lib/auth.ts derives the current organisation and
-- moderator checks from the rows the RLS client can see.
--
-- Atomicity: this file has no BEGIN/COMMIT of its own. scripts/migrate.mjs
-- wraps each migration in a transaction (and a nested COMMIT would break its
-- ledger), `supabase db push` applies a file atomically, and the runbook wraps
-- the SQL-editor paste in BEGIN/COMMIT. In addition, every statement that
-- removes access lives in ONE DO block (section 2), which Postgres executes as
-- a single statement: if any part fails, none of it applies. Section 1 only
-- adds helper and trigger functions and narrows two existing helpers, which is
-- safe to leave in place even if section 2 were never applied. Section 1
-- replaces is_department_admin and is_session_faculty, so it must run as their
-- owner (the runbook's pre-check A4 shows the owner).
--
-- Idempotent: safe to run more than once (CREATE OR REPLACE, DROP ... IF
-- EXISTS before each CREATE, guarded constraint/trigger creation).

-- =============================================================================
-- Section 1. Membership-scoped helper functions
-- =============================================================================
-- All helpers are SECURITY DEFINER with a fixed search_path, like the existing
-- helpers from 004: they run as the table owner, so they read
-- organization_members / department_members / departments / sessions without
-- re-entering RLS (no policy recursion). Each returns a boolean about the
-- CALLER only (auth.uid()), so exposing them through /rest/v1/rpc reveals
-- nothing about other users. auth.uid() is NULL for anon, so every helper is
-- false for anon. They are granted to authenticated (policies call them as the
-- querying role) and service_role, not to anon or PUBLIC.

-- True when the caller has any membership in p_org_id.
CREATE OR REPLACE FUNCTION public.is_org_member_of(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = p_org_id
      AND m.user_id = auth.uid()
  );
$$;

-- True when the caller is org_admin OF p_org_id (unlike is_org_admin(), which
-- only looks at the caller's first organisation and ignores the row).
CREATE OR REPLACE FUNCTION public.is_org_admin_of(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.role = 'org_admin'
  );
$$;

-- True when p_department_id belongs to p_org_id AND the caller moderates it:
-- either org_admin of that organisation, or a department_members moderator row
-- for that department while still a member of the organisation.
CREATE OR REPLACE FUNCTION public.is_department_moderator_in(p_org_id UUID, p_department_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = p_department_id
      AND d.org_id = p_org_id
      AND (
        EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.org_id = d.org_id
            AND om.user_id = auth.uid()
            AND om.role = 'org_admin'
        )
        OR EXISTS (
          SELECT 1
          FROM public.department_members dm
          JOIN public.organization_members om
            ON om.org_id = dm.org_id AND om.user_id = dm.user_id
          WHERE dm.department_id = d.id
            AND dm.org_id = d.org_id
            AND dm.user_id = auth.uid()
            AND dm.role IN ('org_admin', 'department_admin')
        )
      )
  );
$$;

-- True when p_session_id belongs to p_org_id AND the caller moderates the
-- session's department (org admin of the org included).
CREATE OR REPLACE FUNCTION public.is_session_moderator_in(p_org_id UUID, p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = p_session_id
      AND s.org_id = p_org_id
      AND public.is_department_moderator_in(s.org_id, s.department_id)
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_member_of(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_admin_of(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_department_moderator_in(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_session_moderator_in(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member_of(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_admin_of(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_department_moderator_in(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_session_moderator_in(UUID, UUID) TO authenticated, service_role;

-- is_department_admin(dept) used to end in "OR is_org_admin()", which is true
-- for ANY department whenever the caller is org_admin of their own first
-- organisation. It is used by policies on sessions, attendance,
-- attendance_evidence and department_join_requests. Scope it to the
-- department's own organisation. Same signature, parameter name and owner, so
-- CREATE OR REPLACE keeps its existing grants and every dependent policy.
-- (The old body's transaction-local set_config('row_security','off') is not
-- needed: as a SECURITY DEFINER owned by the table owner it already bypasses
-- RLS.)
CREATE OR REPLACE FUNCTION public.is_department_admin(dept_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.is_department_moderator_in(
    (SELECT d.org_id FROM public.departments d WHERE d.id = dept_id),
    dept_id
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- is_session_faculty(sess) had the same unscoped "OR is_org_admin()" branch.
-- No current policy calls it (015 replaced the 002 attendance policies), but
-- it is still callable, so scope it the same way: an assigned teacher of the
-- session (row in the session's own organisation) or a moderator of the
-- session's department, and in both cases a member of the session's org.
CREATE OR REPLACE FUNCTION public.is_session_faculty(sess_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = sess_id
      AND public.is_org_member_of(s.org_id)
      AND (
        EXISTS (
          SELECT 1 FROM public.session_teachers st
          WHERE st.session_id = s.id
            AND st.org_id = s.org_id
            AND st.user_id = auth.uid()
        )
        OR public.is_department_moderator_in(s.org_id, s.department_id)
      )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Department codes: the column DEFAULT generate_department_code() is SECURITY
-- INVOKER and checks uniqueness with a SELECT on departments. Once the broad
-- departments policy is gone (section 2), an org admin creating a department
-- through the RLS client would only see their own organisations' codes, so a
-- code already used by another tenant could be picked and the insert would
-- fail on the UNIQUE constraint. A membership policy cannot fix that (the
-- check needs every tenant's codes), and making the DEFAULT function SECURITY
-- DEFINER would turn it into a callable RPC that, called often enough, reveals
-- which codes are in use by elimination. Instead, a BEFORE INSERT trigger
-- assigns the code: trigger functions cannot be called through the API, run
-- as the owner here, and see every code. Section 2 drops the column DEFAULT so
-- the trigger is the only generator. Rows that supply a code keep it, but only
-- the service role and the owner can supply one (guard below).
--
-- A code is a join capability, so it is drawn from gen_random_uuid() (a
-- strong random source since PostgreSQL 13) rather than RANDOM(). The first 8
-- hex digits of a v4 UUID are fully random; reducing 32 bits modulo 10^6 has
-- negligible bias.
CREATE OR REPLACE FUNCTION public.assign_department_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.department_code IS NULL THEN
    LOOP
      NEW.department_code := LPAD(
        ((('x' || LPAD(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8), 16, '0'))::BIT(64)::BIGINT
          % 1000000))::TEXT,
        6, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.departments WHERE department_code = NEW.department_code
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.assign_department_code() FROM PUBLIC, anon, authenticated;

-- Browser roles must not choose or change a department code. Otherwise an org
-- admin (any self-signup user) can learn which codes are in use by collision:
-- an INSERT ... ON CONFLICT (department_code) DO NOTHING returns only the
-- codes that are free (RLS is not applied to the conflicting row), and a plain
-- unique-violation error or an UPDATE ... SET department_code does the same.
-- This SECURITY INVOKER guard sees the real caller in current_user: for anon
-- and authenticated it discards a supplied code on INSERT (the assign trigger
-- then draws one) and refuses any change on UPDATE. The service role, the
-- owner and SECURITY DEFINER code are unaffected. Its trigger name sorts
-- before departments_assign_code, and BEFORE triggers fire in name order.
CREATE OR REPLACE FUNCTION public.guard_department_code()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.department_code := NULL;
    ELSIF NEW.department_code IS DISTINCT FROM OLD.department_code THEN
      RAISE EXCEPTION 'department_code is server-assigned' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE SET search_path = public;

REVOKE ALL ON FUNCTION public.guard_department_code() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- Section 2. Policy and privilege changes (one atomic statement)
-- =============================================================================
DO $lockdown$
DECLARE
  r RECORD;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 2.1 session_feedback: turn RLS on (013 never did), moderator/own reads only
  -- ---------------------------------------------------------------------------
  ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;

  -- Submissions go through the service role (insertSessionFeedback); no
  -- direct client insert path exists or is wanted.
  DROP POLICY IF EXISTS "Anyone can submit feedback for published sessions" ON public.session_feedback;

  -- Replace the get_user_org_id()-based SELECT policies with membership-based
  -- ones, so a moderator whose arbitrary "first" organisation differs from the
  -- app's current organisation still sees their session's feedback
  -- (listSessionFeedback in lib/db/feedback.ts uses the RLS client).
  DROP POLICY IF EXISTS "Users can view their own feedback" ON public.session_feedback;
  CREATE POLICY "Users can view their own feedback"
    ON public.session_feedback FOR SELECT TO authenticated
    USING (user_id = auth.uid() AND public.is_org_member_of(org_id));

  DROP POLICY IF EXISTS "Department admins and org admins can view all feedback" ON public.session_feedback;
  CREATE POLICY "Department admins and org admins can view all feedback"
    ON public.session_feedback FOR SELECT TO authenticated
    USING (
      public.is_org_admin_of(org_id)
      OR public.is_session_moderator_in(org_id, session_id)
    );

  -- requireDepartmentModerator() admits super admins, who read feedback today
  -- only because RLS was off. Keep that working explicitly.
  DROP POLICY IF EXISTS "Super admins can view feedback" ON public.session_feedback;
  CREATE POLICY "Super admins can view feedback"
    ON public.session_feedback FOR SELECT TO authenticated
    USING (public.is_super_admin());

  REVOKE ALL ON public.session_feedback FROM anon;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.session_feedback FROM authenticated;
  GRANT SELECT ON public.session_feedback TO authenticated;
  GRANT ALL ON public.session_feedback TO service_role;

  -- ---------------------------------------------------------------------------
  -- 2.2 teacher_invitations: service role only
  -- ---------------------------------------------------------------------------
  -- Every app read/write (lib/db/teacher-invitations.ts, certificates.ts,
  -- feedback.ts, ops-reads.ts, teaching-slots.ts) uses the service role. The
  -- two INVOKER triggers that read this table only reach it under the service
  -- role or inside SECURITY DEFINER finalize/reopen RPCs.
  DROP POLICY IF EXISTS "Public can read invitation by code" ON public.teacher_invitations;
  DROP POLICY IF EXISTS "Public can respond to invitation" ON public.teacher_invitations;
  ALTER TABLE public.teacher_invitations ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.teacher_invitations FROM anon, authenticated;
  GRANT ALL ON public.teacher_invitations TO service_role;

  -- ---------------------------------------------------------------------------
  -- 2.3 SECURITY DEFINER RPCs: service role only
  -- ---------------------------------------------------------------------------
  -- These trust caller-supplied org/session/actor ids and have no caller
  -- check. Every app call uses getServiceDb() (lib/db/attendance.ts,
  -- lib/db/recall.ts, lib/db/ops.ts). generate_group_code is the retired
  -- legacy helper (049). Revoked by NAME across every overload that exists,
  -- not by exact signature: a drifted production signature or a leftover
  -- overload would otherwise stay callable without any error. A name with no
  -- function on an older database is simply skipped.
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'record_attendance_evidence_v2',
        'finalize_session_attendance_v2',
        'reopen_session_attendance_v2',
        'rotate_session_group_code_v2',
        'replace_recall_question_set_draft_v1',
        'recall_published_question_set_v1',
        'publish_recall_question_set_v1',
        'record_recall_playback_v1',
        'complete_recall_catchup_v2',
        'claim_ops_newsletter_delivery_v1',
        'generate_group_code'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2.4 organization_members: admins manage only their own organisations
  -- ---------------------------------------------------------------------------
  -- Was FOR ALL USING (is_org_admin()) with no org predicate: any org admin
  -- could insert themselves as org_admin of any tenant. It is split per
  -- command instead of a scoped FOR ALL, because FOR ALL also grants SELECT:
  -- a user whose first membership is not org_admin would start seeing their
  -- own newer org_admin memberships elsewhere, and lib/auth.ts
  -- getCurrentOrgId() (newest VISIBLE own membership) would silently switch
  -- their tenant.
  DROP POLICY IF EXISTS "Org admins can manage organization members" ON public.organization_members;

  -- SELECT reach the old policy gave admins of their first organisation,
  -- minus other tenants' rows. Non-admins gain nothing.
  DROP POLICY IF EXISTS "Org admins can view members of administered organizations" ON public.organization_members;
  CREATE POLICY "Org admins can view members of administered organizations"
    ON public.organization_members FOR SELECT TO authenticated
    USING (public.is_org_admin() AND public.is_org_admin_of(org_id));

  -- No INSERT policy for org admins: with one, an org admin (every self-signup
  -- user) could add ANY user to their own organisation, which becomes that
  -- user's newest membership and can switch their current organisation. The
  -- only RLS-client insert (createOrganization, reached from the super-admin
  -- OrganizationForm) is covered by "Super admins can manage organization
  -- members" (003); onboarding, approvals and personal workspaces use the
  -- service role. Drop a same-named policy from any earlier draft of 062.
  DROP POLICY IF EXISTS "Org admins can insert organization members" ON public.organization_members;

  DROP POLICY IF EXISTS "Org admins can update organization members" ON public.organization_members;
  CREATE POLICY "Org admins can update organization members"
    ON public.organization_members FOR UPDATE TO authenticated
    USING (public.is_org_admin_of(org_id))
    WITH CHECK (public.is_org_admin_of(org_id));

  DROP POLICY IF EXISTS "Org admins can delete organization members" ON public.organization_members;
  CREATE POLICY "Org admins can delete organization members"
    ON public.organization_members FOR DELETE TO authenticated
    USING (public.is_org_admin_of(org_id));

  -- Preserve exactly which of their OWN membership rows a user could see
  -- before. The removed policy let an org admin (of their first organisation)
  -- see all rows, including their own memberships elsewhere; lib/auth.ts
  -- getCurrentOrgId() picks the newest visible own membership, so hiding those
  -- rows would silently switch such a user's current organisation. Non-admins
  -- are unchanged (they only ever saw their first organisation's rows, and no
  -- policy above adds SELECT for them).
  DROP POLICY IF EXISTS "Org admins can view their own memberships" ON public.organization_members;
  CREATE POLICY "Org admins can view their own memberships"
    ON public.organization_members FOR SELECT TO authenticated
    USING (user_id = auth.uid() AND public.is_org_admin());

  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_members FROM anon;
  REVOKE TRUNCATE ON public.organization_members FROM authenticated;
  -- An UPDATE that rewrites user_id or org_id is an insert in disguise; only
  -- the role is editable through the RLS client (no app path updates it).
  REVOKE UPDATE ON public.organization_members FROM authenticated;
  GRANT UPDATE (role) ON public.organization_members TO authenticated;

  -- ---------------------------------------------------------------------------
  -- 2.5 organizations: members and super admins read; admins update their own
  -- ---------------------------------------------------------------------------
  -- Every signed-in user could read every organisation (personal workspaces
  -- are named after their owner) and any org admin could update any row.
  DROP POLICY IF EXISTS "Authenticated users can view organizations" ON public.organizations;

  DROP POLICY IF EXISTS "Users can view organizations they belong to" ON public.organizations;
  CREATE POLICY "Users can view organizations they belong to"
    ON public.organizations FOR SELECT TO authenticated
    USING (public.is_org_member_of(id));

  -- The super-admin console (listAllOrganizations, insert ... RETURNING,
  -- rename, delete via the RLS client) relied on the broad policy for SELECT.
  DROP POLICY IF EXISTS "Super admins can view organizations" ON public.organizations;
  CREATE POLICY "Super admins can view organizations"
    ON public.organizations FOR SELECT TO authenticated
    USING (public.is_super_admin());

  DROP POLICY IF EXISTS "Org admins can update their organizations" ON public.organizations;
  CREATE POLICY "Org admins can update their organizations"
    ON public.organizations FOR UPDATE TO authenticated
    USING (public.is_org_admin_of(id))
    WITH CHECK (public.is_org_admin_of(id));

  -- Direct organisation creation by any signed-in user. The only UI
  -- (OrganizationForm) is shown to super admins, who keep "Super admins can
  -- create organizations" (003); personal workspaces use the service role.
  DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;

  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organizations FROM anon;
  REVOKE TRUNCATE ON public.organizations FROM authenticated;

  -- ---------------------------------------------------------------------------
  -- 2.6 departments: members of the department's organisation only
  -- ---------------------------------------------------------------------------
  -- 012 let any signed-in user read every department, including
  -- department_code (a direct-join capability) and signature_data.
  DROP POLICY IF EXISTS "Authenticated users can view departments" ON public.departments;

  -- Was org_id = get_user_org_id(); membership-based so a user with more than
  -- one membership still sees the departments of the organisation the app
  -- treats as current. "Super admins can view departments" (010) stays.
  DROP POLICY IF EXISTS "Users can view departments in their org" ON public.departments;
  CREATE POLICY "Users can view departments in their org"
    ON public.departments FOR SELECT TO authenticated
    USING (public.is_org_member_of(org_id));

  -- Department codes come from the definer trigger (section 1), not the
  -- invoker DEFAULT that can no longer see other tenants' codes. The guard
  -- trigger fires first (name order) and stops browser roles choosing or
  -- changing a code.
  ALTER TABLE public.departments ALTER COLUMN department_code DROP DEFAULT;
  DROP TRIGGER IF EXISTS departments_aa_guard_code ON public.departments;
  CREATE TRIGGER departments_aa_guard_code
    BEFORE INSERT OR UPDATE OF department_code ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.guard_department_code();
  DROP TRIGGER IF EXISTS departments_assign_code ON public.departments;
  CREATE TRIGGER departments_assign_code
    BEFORE INSERT ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.assign_department_code();

  -- The old DEFAULT generator is no longer used; stop browser roles calling it.
  IF to_regprocedure('public.generate_department_code()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.generate_department_code() FROM PUBLIC, anon, authenticated;
  END IF;

  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.departments FROM anon;
  REVOKE TRUNCATE ON public.departments FROM authenticated;

  -- A session must belong to the same organisation as its department. Without
  -- this an org admin could create a session in their own organisation that
  -- points at another tenant's department; finalization then copies that
  -- department's members into the attacker's roster. NOT VALID: existing rows
  -- are not re-checked (the runbook lists any mismatches); new rows and key
  -- changes are. ON DELETE CASCADE matches the existing department FK.
  CREATE UNIQUE INDEX IF NOT EXISTS departments_id_org_id_key
    ON public.departments (id, org_id);
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_department_org_fkey'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_department_org_fkey
      FOREIGN KEY (department_id, org_id)
      REFERENCES public.departments (id, org_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2.7 department_join_requests: own-tenant moderators only; no self-insert
  -- ---------------------------------------------------------------------------
  -- The moderator policies used the unscoped is_department_admin(); make the
  -- tenant explicit as well (row org must own the department).
  DROP POLICY IF EXISTS "Department moderators can view department join requests" ON public.department_join_requests;
  CREATE POLICY "Department moderators can view department join requests"
    ON public.department_join_requests FOR SELECT TO authenticated
    USING (public.is_department_moderator_in(org_id, department_id));

  DROP POLICY IF EXISTS "Department moderators can update department join requests" ON public.department_join_requests;
  CREATE POLICY "Department moderators can update department join requests"
    ON public.department_join_requests FOR UPDATE TO authenticated
    USING (public.is_department_moderator_in(org_id, department_id))
    WITH CHECK (public.is_department_moderator_in(org_id, department_id));

  -- The self-insert policy let a user file a request naming any org_id and
  -- department_id with any requested role. Combined with the approval action
  -- (which trusts request.org_id and a client-chosen role) that is a path to
  -- org_admin of another tenant. The legacy join UI (JoinOrganizationForm) is
  -- not mounted on main or the branch; current onboarding uses
  -- member_onboarding_requests through the service role. Do not restore a
  -- self-insert policy until approveDepartmentJoinRequest checks the
  -- department's organisation and ignores client-chosen roles.
  DROP POLICY IF EXISTS "Users can create department join requests for themselves" ON public.department_join_requests;

  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.department_join_requests FROM anon;
  REVOKE TRUNCATE ON public.department_join_requests FROM authenticated;

  -- ---------------------------------------------------------------------------
  -- 2.8 session_teachers: the session must belong to the row's organisation
  -- ---------------------------------------------------------------------------
  -- Was org_id = get_user_org_id() AND (is_org_admin() OR ...), with nothing
  -- tying session_id to org_id: an org admin could attach themselves as an
  -- ACCEPTED teacher of another tenant's session.
  DROP POLICY IF EXISTS "Department admins and org admins can manage session teachers" ON public.session_teachers;
  CREATE POLICY "Department admins and org admins can manage session teachers"
    ON public.session_teachers FOR ALL TO authenticated
    USING (public.is_session_moderator_in(org_id, session_id))
    WITH CHECK (public.is_session_moderator_in(org_id, session_id));

  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.session_teachers FROM anon;
  REVOKE TRUNCATE ON public.session_teachers FROM authenticated;

  -- ---------------------------------------------------------------------------
  -- 2.9 certificates: no public listing; own rows and own-tenant moderators
  -- ---------------------------------------------------------------------------
  -- Public verification (/verify, /api/v1/certificates/[code]) uses the
  -- service role (findCertificateByCode).
  DROP POLICY IF EXISTS "Anyone can verify certificates by code" ON public.certificates;

  -- Own certificates are visible regardless of which organisation
  -- get_user_org_id() happens to pick (listMyCertificates and the download
  -- route filter by the app's current organisation and the caller's id).
  DROP POLICY IF EXISTS "Users can view their own certificates" ON public.certificates;
  CREATE POLICY "Users can view their own certificates"
    ON public.certificates FOR SELECT TO authenticated
    USING (
      user_id = auth.uid()
      OR public.is_org_admin_of(org_id)
      OR public.is_department_moderator_in(org_id, department_id)
    );

  -- Moderator issuance (insertCertificate, RLS client, INSERT ... RETURNING).
  -- Same rule as before, scoped to the row's organisation instead of the
  -- caller's first organisation.
  DROP POLICY IF EXISTS "Department admins and org admins can create certificates" ON public.certificates;
  CREATE POLICY "Department admins and org admins can create certificates"
    ON public.certificates FOR INSERT TO authenticated
    WITH CHECK (
      public.is_org_admin_of(org_id)
      OR public.is_department_moderator_in(org_id, department_id)
    );

  REVOKE ALL ON public.certificates FROM anon;
  -- UPDATE/DELETE stay granted but have no policy for authenticated, so RLS
  -- already denies them; revoking would turn the lifecycle trigger's silent
  -- no-op into an error on any future invoker path.
  REVOKE TRUNCATE ON public.certificates FROM authenticated;

  -- ---------------------------------------------------------------------------
  -- 2.10 attendance: computed results are written only by the system
  -- ---------------------------------------------------------------------------
  -- "Admins can lock attendance" let any session teacher (any RSVP status) or
  -- org admin rewrite status/revision/finalized_at directly, bypassing the
  -- finalize/reopen RPCs. All writers are SECURITY DEFINER RPCs or the service
  -- role (lib/db/attendance.ts).
  DROP POLICY IF EXISTS "Admins can lock attendance" ON public.attendance;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance FROM anon, authenticated;

  -- The 015 read policy admitted is_org_admin() (admin of the caller's FIRST
  -- organisation) for rows in ANY organisation the caller belongs to, so an
  -- admin of one tenant who is an ordinary member of another read all of the
  -- other tenant's results. Scoped to the row's organisation; teacher rows
  -- must belong to the session's organisation so cross-tenant session_teachers
  -- rows planted before 062 grant nothing. Everything else is unchanged
  -- (including the RLS-filtered membership subquery, so no user gains rows).
  DROP POLICY IF EXISTS "Users can view computed attendance" ON public.attendance;
  CREATE POLICY "Users can view computed attendance"
    ON public.attendance FOR SELECT TO authenticated
    USING (
      org_id IN (
        SELECT om.org_id FROM public.organization_members om WHERE om.user_id = auth.uid()
      ) AND (
        user_id = auth.uid()
        OR public.is_org_admin_of(attendance.org_id)
        OR EXISTS (
          SELECT 1 FROM public.sessions s
          WHERE s.id = attendance.session_id
            AND (
              public.is_department_admin(s.department_id)
              OR EXISTS (
                SELECT 1 FROM public.session_teachers st
                WHERE st.session_id = s.id
                  AND st.org_id = s.org_id
                  AND st.user_id = auth.uid()
              )
            )
        )
      )
    );

  -- ---------------------------------------------------------------------------
  -- 2.11 attendance_evidence: no unauthenticated/forged FEEDBACK evidence
  -- ---------------------------------------------------------------------------
  -- Feedback is not attendance evidence (spec/03); addEvidence rejects it. The
  -- policy had no caller or subject check.
  DROP POLICY IF EXISTS "Users can create feedback evidence" ON public.attendance_evidence;
  REVOKE ALL ON public.attendance_evidence FROM anon;
  -- Append-only for every client role.
  REVOKE UPDATE, DELETE, TRUNCATE ON public.attendance_evidence FROM authenticated;

  -- Same unscoped is_org_admin() as attendance above, in the read policy
  -- (015) and the v1 TEACHER insert policy (049). Scoped to the row's
  -- organisation; teacher rows must belong to the session's organisation.
  DROP POLICY IF EXISTS "Users can view evidence for accessible sessions" ON public.attendance_evidence;
  CREATE POLICY "Users can view evidence for accessible sessions"
    ON public.attendance_evidence FOR SELECT TO authenticated
    USING (
      org_id IN (
        SELECT om.org_id FROM public.organization_members om WHERE om.user_id = auth.uid()
      ) AND (
        user_id = auth.uid()
        OR public.is_org_admin_of(attendance_evidence.org_id)
        OR EXISTS (
          SELECT 1 FROM public.sessions s
          WHERE s.id = attendance_evidence.session_id
            AND (
              public.is_department_admin(s.department_id)
              OR EXISTS (
                SELECT 1 FROM public.session_teachers st
                WHERE st.session_id = s.id
                  AND st.org_id = s.org_id
                  AND st.user_id = auth.uid()
              )
            )
        )
      )
    );

  DROP POLICY IF EXISTS "Faculty can create teacher evidence" ON public.attendance_evidence;
  CREATE POLICY "Faculty can create teacher evidence"
    ON public.attendance_evidence FOR INSERT TO authenticated
    WITH CHECK (
      org_id IN (
        SELECT om.org_id FROM public.organization_members om WHERE om.user_id = auth.uid()
      )
      AND source = 'TEACHER'
      AND EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = attendance_evidence.session_id
          AND s.org_id = attendance_evidence.org_id
          AND s.department_id = attendance_evidence.department_id
          AND s.attendance_policy_version = 1
          AND (
            public.is_org_admin_of(s.org_id)
            OR public.is_department_admin(s.department_id)
            OR EXISTS (
              SELECT 1 FROM public.session_teachers st
              WHERE st.session_id = s.id
                AND st.org_id = s.org_id
                AND st.user_id = auth.uid()
            )
          )
      )
    );

  -- ---------------------------------------------------------------------------
  -- 2.12 profiles: identity columns are not self-editable
  -- ---------------------------------------------------------------------------
  -- The self-update policy limited rows but not columns, so a user could claim
  -- another person's email (server code resolves identity by profiles.email)
  -- or set email_verified_at. App writes use the service role; the auth.users
  -- sync trigger is SECURITY DEFINER. Display-name columns stay self-editable.
  REVOKE ALL ON public.profiles FROM anon;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles FROM authenticated;
  GRANT UPDATE (first_name, last_name, full_name, grade) ON public.profiles TO authenticated;

  -- ---------------------------------------------------------------------------
  -- 2.13 department_members: the department must belong to the row's org
  -- ---------------------------------------------------------------------------
  -- Was FOR ALL USING/WITH CHECK (org_id = get_user_org_id() AND
  -- is_org_admin()), with nothing tying department_id to org_id: an org admin
  -- (every self-signup user) could insert (own org, ANOTHER tenant's
  -- department, self). Readers that filter by department_id only (reminder
  -- cron, slot publications, finalize_session_attendance_v2's roster copy, the
  -- evidence-scope and lifecycle triggers) then treat them as a member of the
  -- victim department; the victim never sees the row because its own listing
  -- filters by org_id.
  --
  -- Split per command so the change adds no SELECT visibility (lib/auth.ts
  -- moderator checks read the caller's visible department_members rows); the
  -- existing "Users can view department members in their org" SELECT policy
  -- is unchanged. Writes require: admin of the row's organisation, the
  -- department belongs to that organisation, and the target user is already a
  -- member of it. The membership subquery runs under organization_members RLS,
  -- so it fails closed. The only RLS-client writer (addDepartmentMember) has no
  -- caller on main or the branch; every live path uses the service role.
  DROP POLICY IF EXISTS "Org admins can manage department members" ON public.department_members;

  DROP POLICY IF EXISTS "Org admins can insert department members" ON public.department_members;
  CREATE POLICY "Org admins can insert department members"
    ON public.department_members FOR INSERT TO authenticated
    WITH CHECK (
      public.is_org_admin_of(org_id)
      AND public.is_department_moderator_in(org_id, department_id)
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.org_id = department_members.org_id
          AND om.user_id = department_members.user_id
      )
    );

  DROP POLICY IF EXISTS "Org admins can update department members" ON public.department_members;
  CREATE POLICY "Org admins can update department members"
    ON public.department_members FOR UPDATE TO authenticated
    USING (public.is_org_admin_of(org_id))
    WITH CHECK (
      public.is_org_admin_of(org_id)
      AND public.is_department_moderator_in(org_id, department_id)
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.org_id = department_members.org_id
          AND om.user_id = department_members.user_id
      )
    );

  DROP POLICY IF EXISTS "Org admins can delete department members" ON public.department_members;
  CREATE POLICY "Org admins can delete department members"
    ON public.department_members FOR DELETE TO authenticated
    USING (public.is_org_admin_of(org_id));

  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.department_members FROM anon;
  REVOKE TRUNCATE ON public.department_members FROM authenticated;

  -- Same composite key as sessions (2.6), enforced for new rows and key
  -- changes on every path, the service role included. NOT VALID: rows planted
  -- before 062 are not re-checked; the runbook lists them for deletion.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'department_members_department_org_fkey'
      AND conrelid = 'public.department_members'::regclass
  ) THEN
    ALTER TABLE public.department_members
      ADD CONSTRAINT department_members_department_org_fkey
      FOREIGN KEY (department_id, org_id)
      REFERENCES public.departments (id, org_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$lockdown$;

-- PostgREST caches function metadata; refresh it (no-op where not listening).
NOTIFY pgrst, 'reload schema';
