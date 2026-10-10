-- 063: Rota availability (Phase 1, spec/14).
--
-- Purpose: let a trust's rota coordinator upload a minimised rota so that
-- moderators see "Suggested: excused (rostered unavailable)" for trainees the
-- rota had away from a session, and confirm or dismiss each one individually.
-- Rota data never decides attendance: confirmation is a per-person moderator
-- action that writes one MODERATOR_CONFIRMATION evidence row.
--
-- Off by default. Nothing here is reachable until ROTA_INTEGRATION_ENABLED is
-- exactly "true", ROTA_IDENTITY_SECRET is set, an org admin has recorded a DPIA
-- reference + privacy-notice confirmation and enabled the org, and the
-- department is enrolled. Applying this migration changes no existing
-- behaviour.
--
-- Requires 062 (the departments_id_org_id_key unique index backs the composite
-- (department_id, org_id) foreign keys, so a cross-org department id is
-- refused by the database). Apply together with 064: a confirmed rota excusal
-- makes a trainee EXCUSED, which keeps the Recall catch-up only once 064 has
-- widened it (owner decision O2). The application therefore treats rota as
-- "not installed" until recall_catchup_eligible_statuses_v1() (064) exists and
-- includes EXCUSED, and confirm_rota_excusal_v1 checks the same marker, so
-- applying 063 alone can never remove anyone's catch-up route.
--
-- Data minimisation: no person-level rota grid, shift code, leave category,
-- name, email or staff number is ever stored. The only per-person rota data
-- is one flag per (session, trainee) when the trainee was rostered
-- unavailable; identity links hold a keyed HMAC, never the identifier; batch
-- and preview rows hold counts only. Every table is deny-all (RLS enabled, no
-- policies, privileges revoked from PUBLIC/anon/authenticated) and is reached
-- only through the service-role DAL lib/db/rota.ts. Every function is
-- service-role only.
--
-- RPC errors are raised as SQLSTATE P0001 with the fixed message
-- 'rota:<code>' and never contain ids or values.

-- ---------------------------------------------------------------------------
-- 1. Tables (all deny-all)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rota_settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 90),
  horizon_days integer NOT NULL DEFAULT 56 CHECK (horizon_days BETWEEN 7 AND 84),
  dpia_reference text CHECK (dpia_reference IS NULL OR length(btrim(dpia_reference)) BETWEEN 3 AND 120),
  privacy_notice_confirmed_at timestamptz,
  privacy_notice_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_settings_enable_requires_governance
    CHECK (NOT enabled OR (dpia_reference IS NOT NULL AND privacy_notice_confirmed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.rota_departments (
  department_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.rota_settings(org_id) ON DELETE CASCADE,
  enrolled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  -- A department of another organisation is refused by the database.
  CONSTRAINT rota_departments_department_org_fkey FOREIGN KEY (department_id, org_id)
    REFERENCES public.departments(id, org_id) ON DELETE CASCADE,
  CONSTRAINT rota_departments_department_org_key UNIQUE (department_id, org_id)
);

CREATE TABLE IF NOT EXISTS public.rota_uploaders (
  department_id uuid NOT NULL,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id),
  CONSTRAINT rota_uploaders_department_org_fkey FOREIGN KEY (department_id, org_id)
    REFERENCES public.rota_departments(department_id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rota_uploaders_org_user_idx ON public.rota_uploaders (org_id, user_id);

-- Header names + code legend only; no person data.
CREATE TABLE IF NOT EXISTS public.rota_upload_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  department_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 32768),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_upload_profiles_department_name_key UNIQUE (department_id, name),
  CONSTRAINT rota_upload_profiles_department_org_fkey FOREIGN KEY (department_id, org_id)
    REFERENCES public.departments(id, org_id) ON DELETE CASCADE
);

-- Keyed HMAC of a normalised staff number / email, never the identifier.
CREATE TABLE IF NOT EXISTS public.rota_identity_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_type text NOT NULL CHECK (key_type IN ('STAFF_ID', 'EMAIL')),
  key_hmac text NOT NULL CHECK (key_hmac ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('MODERATOR', 'EMAIL_MATCH')),
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key_type, key_hmac)
);
CREATE INDEX IF NOT EXISTS rota_identity_links_user_idx ON public.rota_identity_links (org_id, user_id);

-- Upload audit; counts only. id is the client idempotency key, scoped per org.
-- upload_id ties the batch to the one match preview of that upload (at most
-- one WORKED and one PLANNED batch per upload). payload_digest is a KEYED
-- digest, HMAC-SHA256(ROTA_IDENTITY_SECRET, 'petrios-rota-batch/v1|' ||
-- org_id || '|' || sha256(canonical batch)), so a small batch cannot be
-- brute-forced offline from a database copy or backup.
CREATE TABLE IF NOT EXISTS public.rota_import_batches (
  id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  upload_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'UPLOAD' CHECK (source IN ('UPLOAD')),
  kind text NOT NULL CHECK (kind IN ('PLANNED', 'WORKED')),
  profile_id uuid REFERENCES public.rota_upload_profiles(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  range_from date NOT NULL,
  range_to date NOT NULL,
  people_received integer NOT NULL DEFAULT 0 CHECK (people_received BETWEEN 0 AND 500),
  people_matched integer NOT NULL DEFAULT 0 CHECK (people_matched >= 0),
  people_unmatched integer NOT NULL DEFAULT 0 CHECK (people_unmatched >= 0),
  conflicts integer NOT NULL DEFAULT 0 CHECK (conflicts >= 0),
  -- NOT a count of unavailable people: sessions considered by this batch.
  sessions_annotated integer NOT NULL DEFAULT 0 CHECK (sessions_annotated >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  CONSTRAINT rota_import_batches_upload_kind_key UNIQUE (org_id, upload_id, kind),
  CONSTRAINT rota_import_batches_range_check
    CHECK (range_to >= range_from AND range_to - range_from <= 97),
  CONSTRAINT rota_import_batches_department_org_fkey FOREIGN KEY (department_id, org_id)
    REFERENCES public.departments(id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rota_import_batches_dept_idx
  ON public.rota_import_batches (org_id, department_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS rota_import_batches_created_idx ON public.rota_import_batches (created_at);

-- Membership-oracle audit (one preview per upload, ≤ 500 people, ≤ 10 per
-- uploader per day, enforced atomically by record_rota_match_preview_v1);
-- counts only. Every ingest requires the preview row of its upload.
CREATE TABLE IF NOT EXISTS public.rota_match_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  upload_id uuid NOT NULL,
  caller_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  caller_role text NOT NULL CHECK (caller_role IN ('MODERATOR', 'UPLOADER')),
  people_count integer NOT NULL CHECK (people_count BETWEEN 0 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rota_match_previews_org_upload_key UNIQUE (org_id, upload_id),
  CONSTRAINT rota_match_previews_department_org_fkey FOREIGN KEY (department_id, org_id)
    REFERENCES public.departments(id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rota_match_previews_caller_idx ON public.rota_match_previews (caller_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rota_match_previews_created_idx ON public.rota_match_previews (created_at);

-- The only per-person rota data: one row per (session, trainee) that the rota
-- had unavailable. No category is stored (owner decision O3).
CREATE TABLE IF NOT EXISTS public.rota_session_flags (
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  department_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PLANNED', 'WORKED')),
  as_of timestamptz NOT NULL,
  batch_id uuid NOT NULL,
  -- Snapshot of the session times the flag was computed for (plan D4). A
  -- flag whose snapshot no longer matches the session is ignored and purged.
  session_date_start timestamptz NOT NULL,
  session_date_end timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CONFIRMED', 'DISMISSED', 'CONTESTED')),
  rota_changed_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  contested_at timestamptz,
  -- Hard cap: session_date_end + 90 days.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id),
  CONSTRAINT rota_session_flags_department_org_fkey FOREIGN KEY (department_id, org_id)
    REFERENCES public.departments(id, org_id) ON DELETE CASCADE,
  -- Batches are purged at 12 months and flags expire by 90 days, so this
  -- cascade never removes a live flag.
  CONSTRAINT rota_session_flags_batch_fkey FOREIGN KEY (org_id, batch_id)
    REFERENCES public.rota_import_batches(org_id, id) ON DELETE CASCADE,
  CONSTRAINT rota_session_flags_decided_check
    CHECK ((state IN ('CONFIRMED', 'DISMISSED')) = (decided_at IS NOT NULL)),
  CONSTRAINT rota_session_flags_contested_check
    CHECK ((state = 'CONTESTED') = (contested_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS rota_session_flags_user_idx ON public.rota_session_flags (user_id);
CREATE INDEX IF NOT EXISTS rota_session_flags_dept_idx ON public.rota_session_flags (org_id, department_id);
CREATE INDEX IF NOT EXISTS rota_session_flags_expiry_idx ON public.rota_session_flags (expires_at);
CREATE INDEX IF NOT EXISTS rota_session_flags_batch_idx ON public.rota_session_flags (org_id, batch_id);

-- ---------------------------------------------------------------------------
-- 2. Read view (plan D5): the single place the flag read rule lives.
-- ---------------------------------------------------------------------------
-- A flag is visible only while it is unexpired, its org is enabled, its
-- department is enrolled, the user is still a current trainee of that
-- department, the session still has the snapshot times and is not cancelled.
-- security_invoker: the caller's privileges apply (service_role only).

CREATE OR REPLACE VIEW public.rota_visible_session_flags WITH (security_invoker = true) AS
SELECT f.session_id, f.user_id, f.org_id, f.department_id, f.kind, f.as_of, f.batch_id,
       f.state, f.rota_changed_at, f.decided_by, f.decided_at, f.contested_at, f.expires_at
FROM public.rota_session_flags f
JOIN public.rota_settings rs ON rs.org_id = f.org_id AND rs.enabled
JOIN public.rota_departments rd ON rd.department_id = f.department_id AND rd.org_id = f.org_id
JOIN public.sessions s ON s.id = f.session_id AND s.org_id = f.org_id
     AND s.date_start = f.session_date_start AND s.date_end = f.session_date_end
     AND s.status <> 'CANCELLED'
WHERE f.expires_at > now()
  AND EXISTS (
    SELECT 1 FROM public.department_members dm
    WHERE dm.department_id = f.department_id AND dm.org_id = f.org_id
      AND dm.user_id = f.user_id AND dm.role = 'trainee'
  );

-- ---------------------------------------------------------------------------
-- 3. Lockdown: RLS on, no policies, service_role only.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rota_settings',
    'rota_departments',
    'rota_uploaders',
    'rota_upload_profiles',
    'rota_identity_links',
    'rota_import_batches',
    'rota_match_previews',
    'rota_session_flags'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;

  REVOKE ALL ON public.rota_visible_session_flags FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON public.rota_visible_session_flags TO service_role;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rota_is_department_trainee(
  p_org_id uuid,
  p_department_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.department_members dm
    WHERE dm.org_id = p_org_id
      AND dm.department_id = p_department_id
      AND dm.user_id = p_user_id
      AND dm.role = 'trainee'
  );
$$;

-- One moderator-confirmed identity link (keyed HMAC only). Shared by the
-- ingest and the moderator's "link by staff number" RPC; callers hold the
-- per-org advisory lock. Returns true when stored, false when refused: the
-- user must be a current trainee of the department, and a key is never moved
-- away from a current trainee of ANOTHER enrolled department of the
-- organisation (anti-hijack).
CREATE OR REPLACE FUNCTION public.rota_apply_identity_link(
  p_org_id uuid,
  p_department_id uuid,
  p_actor_user_id uuid,
  p_key_type text,
  p_key_hmac text,
  p_user_id uuid,
  p_origin text,
  p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_existing_user uuid;
BEGIN
  IF NOT public.rota_is_department_trainee(p_org_id, p_department_id, p_user_id) THEN
    RETURN false;
  END IF;

  SELECT l.user_id INTO v_existing_user
  FROM public.rota_identity_links l
  WHERE l.org_id = p_org_id AND l.key_type = p_key_type AND l.key_hmac = p_key_hmac
  FOR UPDATE;

  IF FOUND AND v_existing_user <> p_user_id AND EXISTS (
    SELECT 1
    FROM public.department_members dm
    JOIN public.rota_departments rd
      ON rd.department_id = dm.department_id AND rd.org_id = dm.org_id
    WHERE dm.org_id = p_org_id
      AND dm.user_id = v_existing_user
      AND dm.role = 'trainee'
      AND dm.department_id <> p_department_id
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.rota_identity_links (
    org_id, key_type, key_hmac, user_id, origin, confirmed_by, confirmed_at
  ) VALUES (
    p_org_id, p_key_type, p_key_hmac, p_user_id, p_origin, p_actor_user_id, p_now
  )
  ON CONFLICT (org_id, key_type, key_hmac) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        origin = EXCLUDED.origin,
        confirmed_by = EXCLUDED.confirmed_by,
        confirmed_at = EXCLUDED.confirmed_at;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Retention purge (deletion only). NULL = every org.
-- ---------------------------------------------------------------------------
-- Flags go when: expired (session end + 90 days); the org is disabled or the
-- department un-enrolled; the session is cancelled; the session moved (the
-- snapshot no longer matches); the user is no longer a trainee of the
-- department; or, for a finalized session, retention_days have passed since
-- the later of finalization and the close of any approved Recall catch-up.
-- Links go when the user is no longer a trainee in any enrolled department of
-- an enabled org; uploader grants when the user left the org; batch and
-- preview audit after 12 months. The post-session-reports cron runs this even
-- with the kill switch off (plan D9).

CREATE OR REPLACE FUNCTION public.purge_rota_data_v1(
  p_org_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired integer := 0;
  v_disabled integer := 0;
  v_cancelled integer := 0;
  v_moved integer := 0;
  v_not_trainee integer := 0;
  v_retention integer := 0;
  v_links integer := 0;
  v_uploaders integer := 0;
  v_batches integer := 0;
  v_previews integer := 0;
BEGIN
  DELETE FROM public.rota_session_flags f
  WHERE (p_org_id IS NULL OR f.org_id = p_org_id)
    AND f.expires_at <= now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  DELETE FROM public.rota_session_flags f
  WHERE (p_org_id IS NULL OR f.org_id = p_org_id)
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.rota_settings rs
        WHERE rs.org_id = f.org_id AND rs.enabled
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.rota_departments rd
        WHERE rd.department_id = f.department_id AND rd.org_id = f.org_id
      )
    );
  GET DIAGNOSTICS v_disabled = ROW_COUNT;

  DELETE FROM public.rota_session_flags f
  USING public.sessions s
  WHERE s.id = f.session_id
    AND (p_org_id IS NULL OR f.org_id = p_org_id)
    AND s.status = 'CANCELLED';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  DELETE FROM public.rota_session_flags f
  USING public.sessions s
  WHERE s.id = f.session_id
    AND (p_org_id IS NULL OR f.org_id = p_org_id)
    AND (s.date_start <> f.session_date_start
      OR s.date_end <> f.session_date_end
      OR s.org_id <> f.org_id
      OR s.department_id <> f.department_id);
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  DELETE FROM public.rota_session_flags f
  WHERE (p_org_id IS NULL OR f.org_id = p_org_id)
    AND NOT public.rota_is_department_trainee(f.org_id, f.department_id, f.user_id);
  GET DIAGNOSTICS v_not_trainee = ROW_COUNT;

  DELETE FROM public.rota_session_flags f
  USING public.sessions s, public.rota_settings rs
  WHERE s.id = f.session_id
    AND rs.org_id = f.org_id
    AND (p_org_id IS NULL OR f.org_id = p_org_id)
    AND s.attendance_phase = 'FINALIZED'
    AND greatest(
          coalesce(s.attendance_finalized_at, s.date_end),
          coalesce(
            (SELECT max(q.catchup_closes_at)
             FROM public.recall_question_sets q
             WHERE q.session_id = s.id AND q.status = 'approved'),
            coalesce(s.attendance_finalized_at, s.date_end)
          )
        ) + rs.retention_days * interval '1 day' < now();
  GET DIAGNOSTICS v_retention = ROW_COUNT;

  DELETE FROM public.rota_identity_links l
  WHERE (p_org_id IS NULL OR l.org_id = p_org_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.rota_departments rd
        ON rd.department_id = dm.department_id AND rd.org_id = dm.org_id
      JOIN public.rota_settings rs
        ON rs.org_id = rd.org_id AND rs.enabled
      WHERE dm.org_id = l.org_id
        AND dm.user_id = l.user_id
        AND dm.role = 'trainee'
    );
  GET DIAGNOSTICS v_links = ROW_COUNT;

  DELETE FROM public.rota_uploaders u
  WHERE (p_org_id IS NULL OR u.org_id = p_org_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.org_id = u.org_id AND om.user_id = u.user_id
    );
  GET DIAGNOSTICS v_uploaders = ROW_COUNT;

  DELETE FROM public.rota_import_batches b
  WHERE (p_org_id IS NULL OR b.org_id = p_org_id)
    AND b.created_at < now() - interval '12 months';
  GET DIAGNOSTICS v_batches = ROW_COUNT;

  DELETE FROM public.rota_match_previews p
  WHERE (p_org_id IS NULL OR p.org_id = p_org_id)
    AND p.created_at < now() - interval '12 months';
  GET DIAGNOSTICS v_previews = ROW_COUNT;

  RETURN jsonb_build_object(
    'flags_expired', v_expired,
    'flags_retention', v_retention,
    'flags_cancelled', v_cancelled,
    'flags_not_trainee', v_not_trainee,
    'flags_moved', v_moved,
    'flags_disabled', v_disabled,
    'links', v_links,
    'uploaders', v_uploaders,
    'batches', v_batches,
    'previews', v_previews
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Match preview, ingest and moderator links.
-- ---------------------------------------------------------------------------

-- 6a. The membership-oracle gate, atomically: one preview per (org, upload
-- id); an uploader at most p_max_per_day previews in 24 hours. Count and
-- insert run under a per-caller advisory lock, so parallel previews cannot
-- exceed the limit. Returns 'recorded', 'duplicate' or 'rate_limited'.
CREATE OR REPLACE FUNCTION public.record_rota_match_preview_v1(
  p_org_id uuid,
  p_department_id uuid,
  p_upload_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_people_count integer,
  p_max_per_day integer
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used integer;
BEGIN
  IF p_org_id IS NULL OR p_department_id IS NULL OR p_upload_id IS NULL OR p_caller_user_id IS NULL
     OR p_caller_role IS NULL OR p_caller_role NOT IN ('MODERATOR', 'UPLOADER')
     OR p_people_count IS NULL OR p_people_count NOT BETWEEN 0 AND 500
     OR p_max_per_day IS NULL OR p_max_per_day < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('rota-preview:' || p_caller_user_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.rota_match_previews p
    WHERE p.org_id = p_org_id AND p.upload_id = p_upload_id
  ) THEN
    RETURN 'duplicate';
  END IF;

  IF p_caller_role = 'UPLOADER' THEN
    SELECT count(*) INTO v_used
    FROM public.rota_match_previews p
    WHERE p.caller_user_id = p_caller_user_id
      AND p.created_at > now() - interval '24 hours';
    IF v_used >= p_max_per_day THEN
      RETURN 'rate_limited';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.rota_match_previews (
      org_id, department_id, upload_id, caller_user_id, caller_role, people_count
    ) VALUES (
      p_org_id, p_department_id, p_upload_id, p_caller_user_id, p_caller_role, p_people_count
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN 'duplicate';
  END;
  RETURN 'recorded';
END;
$$;

-- 6b. Ingest: one transaction under a per-org advisory lock.
-- lock → enabled/enrolled → validate → preview of this upload by this caller
-- → idempotency (and at most one batch per kind per upload) → batch row →
-- links → flags → cleared → counts → purge. Receives HMACs and user ids only;
-- the caller (submitRotaUpload) has already matched people and classified
-- each (session, trainee) pair as unavailable (p_flags) or available
-- (p_cleared). Unknown pairs are sent in neither list and leave any flag
-- untouched. Precedence: a PLANNED batch never overwrites or clears a WORKED
-- flag; decided flags (CONFIRMED/DISMISSED/CONTESTED) are never rewritten,
-- only marked rota_changed_at when the rota now disagrees (and unmarked when
-- it agrees again); a flag whose session moved is replaced. Only PUBLISHED
-- sessions receive flags.

CREATE OR REPLACE FUNCTION public.ingest_rota_batch_v1(
  p_org_id uuid,
  p_department_id uuid,
  p_actor_user_id uuid,
  p_batch jsonb,
  p_flags jsonb,
  p_cleared jsonb,
  p_links jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settings public.rota_settings%ROWTYPE;
  v_existing public.rota_import_batches%ROWTYPE;
  v_flag public.rota_session_flags%ROWTYPE;
  v_flags jsonb := coalesce(p_flags, '[]'::jsonb);
  v_cleared jsonb := coalesce(p_cleared, '[]'::jsonb);
  v_links jsonb := coalesce(p_links, '[]'::jsonb);
  v_batch_id uuid;
  v_upload_id uuid;
  v_kind text;
  v_digest text;
  v_from date;
  v_to date;
  v_profile_id uuid;
  v_people_received integer;
  v_people_matched integer;
  v_people_unmatched integer;
  v_conflicts integer;
  v_bad integer;
  v_now timestamptz := now();
  v_flag_total integer := 0;
  v_flag_accepted integer := 0;
  v_cleared_total integer := 0;
  v_cleared_accepted integer := 0;
  v_flags_inserted integer := 0;
  v_flags_replaced integer := 0;
  v_flags_deleted integer := 0;
  v_marked integer := 0;
  v_unmarked integer := 0;
  v_links_upserted integer := 0;
  v_links_refused integer := 0;
  v_sessions_annotated integer := 0;
  r record;
BEGIN
  IF p_org_id IS NULL OR p_department_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;

  -- 1. Serialise every ingest for the org.
  PERFORM pg_advisory_xact_lock(hashtextextended('rota:' || p_org_id::text, 0));

  -- 2. Enabled org + enrolled department.
  SELECT * INTO v_settings FROM public.rota_settings WHERE org_id = p_org_id;
  IF NOT FOUND OR NOT v_settings.enabled OR NOT EXISTS (
    SELECT 1 FROM public.rota_departments rd
    WHERE rd.department_id = p_department_id AND rd.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:disabled';
  END IF;

  -- 3. Shape + DB-side range sanity (the app does the exact check).
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'object'
     OR jsonb_typeof(v_flags) <> 'array'
     OR jsonb_typeof(v_cleared) <> 'array'
     OR jsonb_typeof(v_links) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;

  BEGIN
    v_batch_id := (p_batch->>'id')::uuid;
    v_upload_id := (p_batch->>'upload_id')::uuid;
    v_kind := p_batch->>'kind';
    v_digest := p_batch->>'payload_digest';
    v_from := (p_batch->>'range_from')::date;
    v_to := (p_batch->>'range_to')::date;
    v_profile_id := nullif(p_batch->>'profile_id', '')::uuid;
    v_people_received := coalesce((p_batch->>'people_received')::integer, 0);
    v_people_matched := coalesce((p_batch->>'people_matched')::integer, 0);
    v_people_unmatched := coalesce((p_batch->>'people_unmatched')::integer, 0);
    v_conflicts := coalesce((p_batch->>'conflicts')::integer, 0);

    SELECT count(*) FILTER (WHERE x.session_id IS NULL OR x.user_id IS NULL)
      INTO v_bad
    FROM jsonb_to_recordset(v_flags) AS x(session_id uuid, user_id uuid);
    IF v_bad > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
    END IF;

    SELECT count(*) FILTER (WHERE x.session_id IS NULL OR x.user_id IS NULL)
      INTO v_bad
    FROM jsonb_to_recordset(v_cleared) AS x(session_id uuid, user_id uuid);
    IF v_bad > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
    END IF;

    SELECT count(*) FILTER (
             WHERE x.user_id IS NULL
                OR x.key_type IS NULL OR x.key_type NOT IN ('STAFF_ID', 'EMAIL')
                OR x.key_hmac IS NULL OR x.key_hmac !~ '^[0-9a-f]{64}$'
                OR x.origin IS NULL OR x.origin NOT IN ('MODERATOR', 'EMAIL_MATCH'))
      INTO v_bad
    FROM jsonb_to_recordset(v_links) AS x(key_type text, key_hmac text, user_id uuid, origin text);
    IF v_bad > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
    END IF;
  EXCEPTION
    WHEN data_exception THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END;

  IF v_batch_id IS NULL OR v_upload_id IS NULL
     OR v_kind IS NULL OR v_kind NOT IN ('PLANNED', 'WORKED')
     OR v_digest IS NULL OR v_digest !~ '^[0-9a-f]{64}$'
     OR v_from IS NULL OR v_to IS NULL
     OR v_to < v_from OR v_to - v_from > 97
     OR v_from < current_date - 15
     OR v_to > current_date + v_settings.horizon_days + 1
     OR v_people_received NOT BETWEEN 0 AND 500
     OR v_people_matched < 0 OR v_people_unmatched < 0 OR v_conflicts < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;

  IF v_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rota_upload_profiles rp
    WHERE rp.id = v_profile_id AND rp.org_id = p_org_id AND rp.department_id = p_department_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;

  -- Size: at most 500 people per session (the batch's people cap), a fixed
  -- overall ceiling, and at most 500 links. The cap follows sessions, not
  -- days, so a large department with many sessions is never refused.
  SELECT coalesce(max(per.n), 0) INTO v_bad
  FROM (
    SELECT u.session_id, count(*) AS n
    FROM (
      SELECT x.session_id FROM jsonb_to_recordset(v_flags) AS x(session_id uuid, user_id uuid)
      UNION ALL
      SELECT x.session_id FROM jsonb_to_recordset(v_cleared) AS x(session_id uuid, user_id uuid)
    ) u
    GROUP BY u.session_id
  ) per;
  IF v_bad > 500
     OR jsonb_array_length(v_flags) + jsonb_array_length(v_cleared) > 100000
     OR jsonb_array_length(v_links) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;

  -- A pair cannot be both unavailable and cleared in one batch.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_flags) AS a(session_id uuid, user_id uuid)
    JOIN jsonb_to_recordset(v_cleared) AS b(session_id uuid, user_id uuid)
      ON a.session_id = b.session_id AND a.user_id = b.user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;

  -- 4. The upload's one match preview, by this caller, for this department.
  IF NOT EXISTS (
    SELECT 1 FROM public.rota_match_previews p
    WHERE p.org_id = p_org_id
      AND p.upload_id = v_upload_id
      AND p.department_id = p_department_id
      AND p.caller_user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:preview_required';
  END IF;

  -- 5. Idempotency, per tenant; at most one batch per kind per upload.
  SELECT * INTO v_existing
  FROM public.rota_import_batches
  WHERE org_id = p_org_id AND id = v_batch_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.payload_digest = v_digest
       AND v_existing.department_id = p_department_id
       AND v_existing.upload_id = v_upload_id
       AND v_existing.kind = v_kind THEN
      RETURN jsonb_build_object(
        'batch_id', v_existing.id,
        'replayed', true,
        'flags_inserted', 0,
        'flags_replaced', 0,
        'flags_deleted', 0,
        'decided_marked_changed', 0,
        'decided_unmarked', 0,
        'links_upserted', 0,
        'links_refused', 0,
        'rows_rejected', 0,
        'sessions_annotated', v_existing.sessions_annotated,
        'people_received', v_existing.people_received,
        'people_matched', v_existing.people_matched,
        'people_unmatched', v_existing.people_unmatched,
        'conflicts', v_existing.conflicts
      );
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:batch_conflict';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rota_import_batches b
    WHERE b.org_id = p_org_id AND b.upload_id = v_upload_id AND b.kind = v_kind
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:batch_conflict';
  END IF;

  -- 6. Batch audit row (counts and a keyed digest only).
  INSERT INTO public.rota_import_batches (
    id, org_id, department_id, upload_id, source, kind, profile_id, uploaded_by,
    payload_digest, range_from, range_to, people_received, people_matched,
    people_unmatched, conflicts, sessions_annotated, created_at
  ) VALUES (
    v_batch_id, p_org_id, p_department_id, v_upload_id, 'UPLOAD', v_kind, v_profile_id, p_actor_user_id,
    v_digest, v_from, v_to, v_people_received, v_people_matched,
    v_people_unmatched, v_conflicts, 0, v_now
  );

  -- 7. Moderator-confirmed identity links (keyed HMAC only).
  FOR r IN
    SELECT DISTINCT ON (x.key_type, x.key_hmac) x.key_type, x.key_hmac, x.user_id, x.origin
    FROM jsonb_to_recordset(v_links) AS x(key_type text, key_hmac text, user_id uuid, origin text)
    ORDER BY x.key_type, x.key_hmac
  LOOP
    IF public.rota_apply_identity_link(
         p_org_id, p_department_id, p_actor_user_id, r.key_type, r.key_hmac, r.user_id, r.origin, v_now) THEN
      v_links_upserted := v_links_upserted + 1;
    ELSE
      v_links_refused := v_links_refused + 1;
    END IF;
  END LOOP;

  -- 8. Unavailable pairs → flags.
  SELECT count(*) INTO v_flag_total
  FROM (SELECT DISTINCT x.session_id, x.user_id
        FROM jsonb_to_recordset(v_flags) AS x(session_id uuid, user_id uuid)) d;

  FOR r IN
    SELECT DISTINCT x.session_id, x.user_id, s.date_start, s.date_end
    FROM jsonb_to_recordset(v_flags) AS x(session_id uuid, user_id uuid)
    JOIN public.sessions s
      ON s.id = x.session_id
     AND s.org_id = p_org_id
     AND s.department_id = p_department_id
     AND s.attendance_policy_version = 2
     AND s.status = 'PUBLISHED'
     AND s.attendance_phase <> 'FINALIZED'
     AND s.date_end >= v_now - interval '14 days'
    WHERE public.rota_is_department_trainee(p_org_id, p_department_id, x.user_id)
  LOOP
    v_flag_accepted := v_flag_accepted + 1;

    SELECT * INTO v_flag
    FROM public.rota_session_flags
    WHERE session_id = r.session_id AND user_id = r.user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.rota_session_flags (
        session_id, user_id, org_id, department_id, kind, as_of, batch_id,
        session_date_start, session_date_end, state, expires_at
      ) VALUES (
        r.session_id, r.user_id, p_org_id, p_department_id, v_kind, v_now, v_batch_id,
        r.date_start, r.date_end, 'OPEN', r.date_end + interval '90 days'
      );
      v_flags_inserted := v_flags_inserted + 1;
    ELSIF v_flag.session_date_start <> r.date_start OR v_flag.session_date_end <> r.date_end
          OR v_flag.org_id <> p_org_id OR v_flag.department_id <> p_department_id THEN
      -- The session moved: any earlier decision was about different times.
      DELETE FROM public.rota_session_flags
      WHERE session_id = r.session_id AND user_id = r.user_id;
      INSERT INTO public.rota_session_flags (
        session_id, user_id, org_id, department_id, kind, as_of, batch_id,
        session_date_start, session_date_end, state, expires_at
      ) VALUES (
        r.session_id, r.user_id, p_org_id, p_department_id, v_kind, v_now, v_batch_id,
        r.date_start, r.date_end, 'OPEN', r.date_end + interval '90 days'
      );
      v_flags_replaced := v_flags_replaced + 1;
    ELSIF v_flag.state = 'OPEN' THEN
      IF NOT (v_flag.kind = 'WORKED' AND v_kind = 'PLANNED') THEN
        UPDATE public.rota_session_flags
        SET kind = v_kind, as_of = v_now, batch_id = v_batch_id,
            session_date_start = r.date_start, session_date_end = r.date_end,
            expires_at = r.date_end + interval '90 days', updated_at = v_now
        WHERE session_id = r.session_id AND user_id = r.user_id;
        v_flags_replaced := v_flags_replaced + 1;
      END IF;
    ELSIF NOT (v_flag.kind = 'WORKED' AND v_kind = 'PLANNED')
          AND v_flag.rota_changed_at IS NOT NULL THEN
      -- Decided flag and the rota agrees again.
      UPDATE public.rota_session_flags
      SET rota_changed_at = NULL, updated_at = v_now
      WHERE session_id = r.session_id AND user_id = r.user_id;
      v_unmarked := v_unmarked + 1;
    END IF;
  END LOOP;

  -- 9. Available pairs → clear OPEN flags, mark decided ones.
  SELECT count(*) INTO v_cleared_total
  FROM (SELECT DISTINCT x.session_id, x.user_id
        FROM jsonb_to_recordset(v_cleared) AS x(session_id uuid, user_id uuid)) d;

  FOR r IN
    SELECT DISTINCT x.session_id, x.user_id, s.date_start, s.date_end
    FROM jsonb_to_recordset(v_cleared) AS x(session_id uuid, user_id uuid)
    JOIN public.sessions s
      ON s.id = x.session_id
     AND s.org_id = p_org_id
     AND s.department_id = p_department_id
     AND s.attendance_policy_version = 2
     AND s.status = 'PUBLISHED'
     AND s.attendance_phase <> 'FINALIZED'
     AND s.date_end >= v_now - interval '14 days'
    WHERE public.rota_is_department_trainee(p_org_id, p_department_id, x.user_id)
  LOOP
    v_cleared_accepted := v_cleared_accepted + 1;

    SELECT * INTO v_flag
    FROM public.rota_session_flags
    WHERE session_id = r.session_id AND user_id = r.user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    ELSIF v_flag.session_date_start <> r.date_start OR v_flag.session_date_end <> r.date_end
          OR v_flag.org_id <> p_org_id OR v_flag.department_id <> p_department_id THEN
      DELETE FROM public.rota_session_flags
      WHERE session_id = r.session_id AND user_id = r.user_id;
      v_flags_deleted := v_flags_deleted + 1;
    ELSIF v_flag.kind = 'WORKED' AND v_kind = 'PLANNED' THEN
      CONTINUE;
    ELSIF v_flag.state = 'OPEN' THEN
      DELETE FROM public.rota_session_flags
      WHERE session_id = r.session_id AND user_id = r.user_id;
      v_flags_deleted := v_flags_deleted + 1;
    ELSIF v_flag.rota_changed_at IS NULL THEN
      UPDATE public.rota_session_flags
      SET rota_changed_at = v_now, updated_at = v_now
      WHERE session_id = r.session_id AND user_id = r.user_id;
      v_marked := v_marked + 1;
    END IF;
  END LOOP;

  -- 10. Sessions considered (not a count of unavailable people).
  SELECT count(DISTINCT u.session_id) INTO v_sessions_annotated
  FROM (
    SELECT x.session_id, x.user_id FROM jsonb_to_recordset(v_flags) AS x(session_id uuid, user_id uuid)
    UNION
    SELECT x.session_id, x.user_id FROM jsonb_to_recordset(v_cleared) AS x(session_id uuid, user_id uuid)
  ) u
  JOIN public.sessions s
    ON s.id = u.session_id
   AND s.org_id = p_org_id
   AND s.department_id = p_department_id
   AND s.attendance_policy_version = 2
   AND s.status = 'PUBLISHED'
   AND s.attendance_phase <> 'FINALIZED'
   AND s.date_end >= v_now - interval '14 days'
  WHERE public.rota_is_department_trainee(p_org_id, p_department_id, u.user_id);

  UPDATE public.rota_import_batches
  SET sessions_annotated = v_sessions_annotated
  WHERE org_id = p_org_id AND id = v_batch_id;

  -- 11. Retention backstop (matters where crons are off).
  PERFORM public.purge_rota_data_v1(p_org_id);

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'replayed', false,
    'flags_inserted', v_flags_inserted,
    'flags_replaced', v_flags_replaced,
    'flags_deleted', v_flags_deleted,
    'decided_marked_changed', v_marked,
    'decided_unmarked', v_unmarked,
    'links_upserted', v_links_upserted,
    'links_refused', v_links_refused,
    'rows_rejected', (v_flag_total - v_flag_accepted) + (v_cleared_total - v_cleared_accepted),
    'sessions_annotated', v_sessions_annotated,
    'people_received', v_people_received,
    'people_matched', v_people_matched,
    'people_unmatched', v_people_unmatched,
    'conflicts', v_conflicts
  );
END;
$$;

-- 6c. A moderator links one current trainee to a staff number and/or email
-- typed on the department rota page (new starters after a changeover), so
-- the export never has to be passed around. Keyed HMACs only; the same
-- trainee and anti-hijack rules as the ingest. Returns linked/refused counts.
CREATE OR REPLACE FUNCTION public.link_rota_identity_v1(
  p_org_id uuid,
  p_department_id uuid,
  p_actor_user_id uuid,
  p_user_id uuid,
  p_links jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_linked integer := 0;
  v_refused integer := 0;
  v_bad integer;
  v_now timestamptz := now();
  r record;
BEGIN
  IF p_org_id IS NULL OR p_department_id IS NULL OR p_actor_user_id IS NULL OR p_user_id IS NULL
     OR p_links IS NULL OR jsonb_typeof(p_links) <> 'array'
     OR jsonb_array_length(p_links) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;
  SELECT count(*) FILTER (
           WHERE x.key_type IS NULL OR x.key_type NOT IN ('STAFF_ID', 'EMAIL')
              OR x.key_hmac IS NULL OR x.key_hmac !~ '^[0-9a-f]{64}$')
    INTO v_bad
  FROM jsonb_to_recordset(p_links) AS x(key_type text, key_hmac text);
  IF v_bad > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:invalid_payload';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('rota:' || p_org_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.rota_settings rs WHERE rs.org_id = p_org_id AND rs.enabled
  ) OR NOT EXISTS (
    SELECT 1 FROM public.rota_departments rd
    WHERE rd.department_id = p_department_id AND rd.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:disabled';
  END IF;
  IF NOT public.rota_is_department_trainee(p_org_id, p_department_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:not_eligible';
  END IF;

  FOR r IN
    SELECT DISTINCT ON (x.key_type) x.key_type, x.key_hmac
    FROM jsonb_to_recordset(p_links) AS x(key_type text, key_hmac text)
    ORDER BY x.key_type
  LOOP
    IF public.rota_apply_identity_link(
         p_org_id, p_department_id, p_actor_user_id, r.key_type, r.key_hmac, p_user_id, 'MODERATOR', v_now) THEN
      v_linked := v_linked + 1;
    ELSE
      v_refused := v_refused + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('linked', v_linked, 'refused', v_refused);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Moderator and trainee decisions on a flag
-- ---------------------------------------------------------------------------
-- 7a. Transactional confirm of one suggestion (DESIGN §3.1 step 4).
-- Recall marker (064) → session row lock → enabled/enrolled → confirmable
-- (policy v2, PUBLISHED, not finalized/locked, ended) → current trainee →
-- OPEN flag with matching snapshot moves to CONFIRMED → no valid presence
-- evidence → no catch-up (RECALL) evidence → no existing moderator decision →
-- one MODERATOR_CONFIRMATION (EXCUSED, reason code ROTA_UNAVAILABLE, batch id
-- in metadata, deterministic source_event_key) → activity event. Any refusal
-- rolls the whole transaction back. A concurrent second confirm waits on the
-- session lock, then finds no OPEN flag.

CREATE OR REPLACE FUNCTION public.confirm_rota_excusal_v1(
  p_org_id uuid,
  p_session_id uuid,
  p_user_id uuid,
  p_actor_user_id uuid
) RETURNS public.attendance
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_flag public.rota_session_flags%ROWTYPE;
  v_result public.attendance%ROWTYPE;
BEGIN
  IF p_org_id IS NULL OR p_session_id IS NULL OR p_user_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:not_found';
  END IF;

  -- O2: an excusal must keep the catch-up route. Before 064 the marker is
  -- missing (42883, read by the app as "not installed"); a marker without
  -- EXCUSED is refused as disabled.
  IF NOT ('EXCUSED' = ANY (public.recall_catchup_eligible_statuses_v1())) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:disabled';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rota_settings rs WHERE rs.org_id = p_org_id AND rs.enabled
  ) OR NOT EXISTS (
    SELECT 1 FROM public.rota_departments rd
    WHERE rd.department_id = v_session.department_id AND rd.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:disabled';
  END IF;

  IF v_session.attendance_policy_version <> 2
     OR v_session.status <> 'PUBLISHED'
     OR v_session.attendance_phase = 'FINALIZED'
     OR coalesce(v_session.attendance_locked, false)
     OR v_session.date_end > now() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:not_confirmable';
  END IF;

  IF NOT public.rota_is_department_trainee(p_org_id, v_session.department_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:not_eligible';
  END IF;

  UPDATE public.rota_session_flags
  SET state = 'CONFIRMED', decided_by = p_actor_user_id, decided_at = now(), updated_at = now()
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND org_id = p_org_id
    AND state = 'OPEN'
    AND expires_at > now()
    AND session_date_start = v_session.date_start
    AND session_date_end = v_session.date_end
  RETURNING * INTO v_flag;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:suggestion_changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_evidence ev
    WHERE ev.session_id = p_session_id
      AND ev.user_id = p_user_id
      AND ev.source IN ('SELF_CHECKIN', 'GROUP_CODE', 'TEAMS', 'TEACHER')
      AND public.is_evidence_valid(p_session_id, ev.source, ev.observed_at)
      AND NOT (
        ev.source = 'TEACHER'
        AND coalesce((ev.metadata->>'assigned_as_teacher')::boolean, false)
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:presence_evidence';
  END IF;

  -- A completed catch-up (after a reopen) is already a decision: a new
  -- excusal recorded after it would outrank it and could not be redone.
  IF EXISTS (
    SELECT 1 FROM public.attendance_evidence ev
    WHERE ev.session_id = p_session_id
      AND ev.user_id = p_user_id
      AND ev.source = 'RECALL'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:caught_up';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_evidence ev
    WHERE ev.session_id = p_session_id
      AND ev.user_id = p_user_id
      AND ev.source = 'MODERATOR_CONFIRMATION'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:already_decided';
  END IF;

  v_result := public.record_attendance_evidence_v2(
    p_org_id,
    p_session_id,
    v_session.department_id,
    p_user_id,
    NULL,
    'MODERATOR_CONFIRMATION',
    now(),
    jsonb_build_object(
      'status_override', 'EXCUSED',
      'reason_code', 'ROTA_UNAVAILABLE',
      'rota_batch_id', v_flag.batch_id,
      'rota_kind', v_flag.kind,
      'rota_as_of', v_flag.as_of,
      'actor_user_id', p_actor_user_id
    ),
    p_actor_user_id,
    'ROTA_EXCUSAL:' || p_session_id::text || ':' || p_user_id::text || ':' || v_session.attendance_revision::text,
    'Rostered unavailable (rota)'
  );

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id,
    subject_user_id, details
  ) VALUES (
    p_org_id, v_session.department_id, p_session_id, 'ROTA_EXCUSAL_CONFIRMED',
    p_actor_user_id, p_user_id,
    jsonb_build_object('batch_id', v_flag.batch_id, 'kind', v_flag.kind)
  );

  RETURN v_result;
END;
$$;

-- 7b. Dismiss (moderator) and 7c. contest (the trainee, own row only): a
-- conditional OPEN → DISMISSED / CONTESTED move of a flag whose snapshot still
-- matches the session, plus a lasting session activity event (no category),
-- because the purge deletes the flag itself after retention. Return false
-- when no OPEN flag moved. The action checks timing and authorization.

CREATE OR REPLACE FUNCTION public.dismiss_rota_suggestion_v1(
  p_org_id uuid,
  p_session_id uuid,
  p_user_id uuid,
  p_actor_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_flag public.rota_session_flags%ROWTYPE;
BEGIN
  IF p_org_id IS NULL OR p_session_id IS NULL OR p_user_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:not_found';
  END IF;

  UPDATE public.rota_session_flags f
  SET state = 'DISMISSED', decided_by = p_actor_user_id, decided_at = now(), updated_at = now()
  FROM public.sessions s
  WHERE f.session_id = p_session_id
    AND f.user_id = p_user_id
    AND f.org_id = p_org_id
    AND f.state = 'OPEN'
    AND f.expires_at > now()
    AND s.id = f.session_id
    AND s.org_id = f.org_id
    AND s.date_start = f.session_date_start
    AND s.date_end = f.session_date_end
  RETURNING f.* INTO v_flag;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id,
    subject_user_id, details
  ) VALUES (
    p_org_id, v_flag.department_id, p_session_id, 'ROTA_SUGGESTION_DISMISSED',
    p_actor_user_id, p_user_id,
    jsonb_build_object('batch_id', v_flag.batch_id, 'kind', v_flag.kind)
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.contest_rota_flag_v1(
  p_org_id uuid,
  p_session_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_flag public.rota_session_flags%ROWTYPE;
BEGIN
  IF p_org_id IS NULL OR p_session_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:not_found';
  END IF;

  UPDATE public.rota_session_flags f
  SET state = 'CONTESTED', contested_at = now(), updated_at = now()
  FROM public.sessions s
  WHERE f.session_id = p_session_id
    AND f.user_id = p_user_id
    AND f.org_id = p_org_id
    AND f.state = 'OPEN'
    AND f.expires_at > now()
    AND s.id = f.session_id
    AND s.org_id = f.org_id
    AND s.date_start = f.session_date_start
    AND s.date_end = f.session_date_end
  RETURNING f.* INTO v_flag;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id,
    subject_user_id, details
  ) VALUES (
    p_org_id, v_flag.department_id, p_session_id, 'ROTA_FLAG_CONTESTED',
    p_user_id, p_user_id,
    jsonb_build_object('batch_id', v_flag.batch_id, 'kind', v_flag.kind)
  );
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Hard disable for an org
-- ---------------------------------------------------------------------------
-- Deletes the org's flags and identity links and sets enabled = false. Keeps
-- profiles, uploader grants, enrolled departments, batch audit and previews,
-- none of which hold rota status. The action logs the returned counts.

CREATE OR REPLACE FUNCTION public.disable_rota_for_org_v1(
  p_org_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_flags integer := 0;
  v_links integer := 0;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:not_found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('rota:' || p_org_id::text, 0));
  PERFORM 1 FROM public.rota_settings WHERE org_id = p_org_id FOR UPDATE;

  DELETE FROM public.rota_session_flags WHERE org_id = p_org_id;
  GET DIAGNOSTICS v_flags = ROW_COUNT;

  DELETE FROM public.rota_identity_links WHERE org_id = p_org_id;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  UPDATE public.rota_settings
  SET enabled = false, updated_at = now()
  WHERE org_id = p_org_id;

  RETURN jsonb_build_object('flags', v_flags, 'links', v_links);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges: service_role only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.rota_is_department_trainee(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_rota_data_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_rota_batch_v1(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_rota_excusal_v1(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_rota_for_org_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rota_apply_identity_link(uuid, uuid, uuid, text, text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_rota_match_preview_v1(uuid, uuid, uuid, uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_rota_identity_v1(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dismiss_rota_suggestion_v1(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contest_rota_flag_v1(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rota_is_department_trainee(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_rota_data_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_rota_batch_v1(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_rota_excusal_v1(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.disable_rota_for_org_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rota_apply_identity_link(uuid, uuid, uuid, text, text, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_rota_match_preview_v1(uuid, uuid, uuid, uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_rota_identity_v1(uuid, uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_rota_suggestion_v1(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.contest_rota_flag_v1(uuid, uuid, uuid) TO service_role;

COMMENT ON TABLE public.rota_session_flags IS
  'Rota availability (063): one row per (session, trainee) the rota had unavailable. No category. Read through rota_visible_session_flags; purged by purge_rota_data_v1.';
COMMENT ON VIEW public.rota_visible_session_flags IS
  'Rota flag read rule (plan D5): unexpired, org enabled, department enrolled, current trainee, session times unchanged, not cancelled.';
COMMENT ON FUNCTION public.confirm_rota_excusal_v1(uuid, uuid, uuid, uuid) IS
  'Rota availability: one moderator confirms one suggestion; writes one MODERATOR_CONFIRMATION EXCUSED row (reason_code ROTA_UNAVAILABLE). Rota data never decides attendance on its own.';
