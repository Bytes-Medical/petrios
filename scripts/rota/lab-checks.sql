-- Rota availability lab checks (plan §5.2: L1–L5h, L7 except the concurrent
-- L7c, L8–L14; L4b upload/preview binding and the per-session size cap, L5h
-- the moderator link, L7j the catch-up refusal, L7k dismiss/contest events,
-- L14 the atomic preview limit). LAB DATABASE ONLY: run through scripts/rota/run-lab-checks.sh,
-- which refuses any target other than 127.0.0.1:55322 and applies 063/064
-- first. Everything below runs inside one transaction that is ROLLED BACK, so
-- the lab is left exactly as it was. All data is synthetic.
--
-- Each check is a DO block that raises 'FAIL Lx: …' on the first violation.
-- One transaction means now() is constant throughout; where real time would
-- separate two events (e.g. a moderator confirmation and a later catch-up)
-- the check shifts a timestamp explicitly and says so.

\set ON_ERROR_STOP 1
SET client_min_messages = warning;

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE rota_fx (k text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

CREATE FUNCTION pg_temp.fx(p_key text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM rota_fx WHERE k = p_key;
  IF v IS NULL THEN RAISE EXCEPTION 'fixture key missing: %', p_key; END IF;
  RETURN v;
END $$;

-- Expect a 'rota:<code>' failure from p_sql; the failing statement's writes
-- roll back with the sub-block.
CREATE FUNCTION pg_temp.expect_rota(p_sql text, p_code text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'rota:' || p_code THEN RETURN; END IF;
    RAISE EXCEPTION 'FAIL %: expected rota:% but got % %', p_label, p_code, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL %: expected rota:% but the call succeeded', p_label, p_code;
END $$;

-- Expect a specific SQLSTATE from p_sql.
CREATE FUNCTION pg_temp.expect_state(p_sql text, p_state text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'FAIL %: expected SQLSTATE % but got % %', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL %: expected SQLSTATE % but the statement succeeded', p_label, p_state;
END $$;

-- Preview helper: the upload's one match preview by a caller (the ingest
-- requires it). Idempotent per (org, upload).
CREATE FUNCTION pg_temp.preview(p_org uuid, p_dept uuid, p_upload uuid, p_caller uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.rota_match_previews (org_id, department_id, upload_id, caller_user_id, caller_role, people_count)
  VALUES (p_org, p_dept, p_upload, p_caller, 'MODERATOR', 1)
  ON CONFLICT (org_id, upload_id) DO NOTHING
$$;

-- Ingest helper: range is today−3 … today+5 (local), a synthetic digest; the
-- upload id equals the batch id (one batch per upload) and its preview by the
-- moderator is recorded first.
CREATE FUNCTION pg_temp.ingest(
  p_org text, p_dept text, p_batch uuid, p_kind text, p_hash_seed text,
  p_flags jsonb, p_cleared jsonb, p_links jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.preview(pg_temp.fx(p_org), pg_temp.fx(p_dept), p_batch, pg_temp.fx('u_mod_a'));
  RETURN public.ingest_rota_batch_v1(
    pg_temp.fx(p_org), pg_temp.fx(p_dept), pg_temp.fx('u_mod_a'),
    jsonb_build_object(
      'id', p_batch, 'upload_id', p_batch, 'kind', p_kind,
      'payload_digest', encode(sha256(convert_to(p_hash_seed, 'UTF8')), 'hex'),
      'range_from', current_date - 3, 'range_to', current_date + 5,
      'profile_id', NULL, 'people_received', 6, 'people_matched', 5,
      'people_unmatched', 1, 'conflicts', 0),
    p_flags, p_cleared, p_links);
END $$;

CREATE FUNCTION pg_temp.pair(p_session text, p_user text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('session_id', pg_temp.fx(p_session), 'user_id', pg_temp.fx(p_user))
$$;

CREATE FUNCTION pg_temp.hmac(p_seed text) RETURNS text
LANGUAGE sql AS $$ SELECT encode(sha256(convert_to('lab-link|' || p_seed, 'UTF8')), 'hex') $$;

DO $$
DECLARE
  u text;
  v_id uuid;
  base timestamptz := date_trunc('minute', now());
BEGIN
  -- Users (synthetic; profiles are created by the auth.users trigger).
  FOREACH u IN ARRAY ARRAY['u_admin_a','u_mod_a','u_t1','u_t2','u_t3','u_t4','u_t5','u_t6',
                           'u_t7','u_t8','u_fac','u_admin_b','u_t_b','u_outsider','u_teacher']
  LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'rota-lab-' || u || '-' || substr(v_id::text, 1, 8) || '@example.test',
            jsonb_build_object('full_name', 'Lab ' || u), now(), now());
    INSERT INTO rota_fx VALUES (u, v_id);
  END LOOP;

  INSERT INTO public.organizations (name, created_by) VALUES ('Rota Lab Org A', pg_temp.fx('u_admin_a')) RETURNING id INTO v_id;
  INSERT INTO rota_fx VALUES ('org_a', v_id);
  INSERT INTO public.organizations (name, created_by) VALUES ('Rota Lab Org B', pg_temp.fx('u_admin_b')) RETURNING id INTO v_id;
  INSERT INTO rota_fx VALUES ('org_b', v_id);
  INSERT INTO public.organizations (name, created_by) VALUES ('Rota Lab Org C', pg_temp.fx('u_admin_b')) RETURNING id INTO v_id;
  INSERT INTO rota_fx VALUES ('org_c', v_id);

  INSERT INTO public.departments (org_id, name, created_by) VALUES (pg_temp.fx('org_a'), 'Rota Lab A1', pg_temp.fx('u_admin_a')) RETURNING id INTO v_id;
  INSERT INTO rota_fx VALUES ('dept_a1', v_id);
  INSERT INTO public.departments (org_id, name, created_by) VALUES (pg_temp.fx('org_a'), 'Rota Lab A2', pg_temp.fx('u_admin_a')) RETURNING id INTO v_id;
  INSERT INTO rota_fx VALUES ('dept_a2', v_id);
  INSERT INTO public.departments (org_id, name, created_by) VALUES (pg_temp.fx('org_a'), 'Rota Lab A3', pg_temp.fx('u_admin_a')) RETURNING id INTO v_id;
  INSERT INTO rota_fx VALUES ('dept_a3', v_id);
  INSERT INTO public.departments (org_id, name, created_by) VALUES (pg_temp.fx('org_b'), 'Rota Lab B1', pg_temp.fx('u_admin_b')) RETURNING id INTO v_id;
  INSERT INTO rota_fx VALUES ('dept_b1', v_id);
  INSERT INTO public.departments (org_id, name, created_by) VALUES (pg_temp.fx('org_b'), 'Rota Lab B2', pg_temp.fx('u_admin_b')) RETURNING id INTO v_id;
  INSERT INTO rota_fx VALUES ('dept_b2', v_id);

  INSERT INTO public.organization_members (org_id, user_id, role) VALUES
    (pg_temp.fx('org_a'), pg_temp.fx('u_admin_a'), 'org_admin'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_mod_a'), 'department_admin'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_t1'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_t2'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_t3'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_t4'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_t5'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_t6'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_t7'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_t8'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_fac'), 'faculty'),
    (pg_temp.fx('org_a'), pg_temp.fx('u_teacher'), 'trainee'),
    (pg_temp.fx('org_b'), pg_temp.fx('u_admin_b'), 'org_admin'),
    (pg_temp.fx('org_b'), pg_temp.fx('u_t_b'), 'trainee');

  INSERT INTO public.department_members (org_id, department_id, user_id, role) VALUES
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_mod_a'), 'department_admin'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t1'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t2'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t3'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t4'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t5'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t7'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t8'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_teacher'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_fac'), 'faculty'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a2'), pg_temp.fx('u_t6'), 'trainee'),
    (pg_temp.fx('org_a'), pg_temp.fx('dept_a3'), pg_temp.fx('u_t8'), 'trainee'),
    (pg_temp.fx('org_b'), pg_temp.fx('dept_b1'), pg_temp.fx('u_t_b'), 'trainee');

  -- Sessions (A1 unless stated). All policy v2 unless stated.
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Ended', base - interval '3 hours', base - interval '2 hours', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_past', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Future', base + interval '3 days', base + interval '3 days 1 hour', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_future', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by, attendance_policy_version)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Policy v1', base - interval '3 hours', base - interval '2 hours', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'), 1)
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_v1', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Draft', base + interval '1 day', base + interval '1 day 1 hour', 'IN_PERSON', 'DRAFT', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_draft', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Cancelled', base + interval '1 day', base + interval '1 day 1 hour', 'IN_PERSON', 'CANCELLED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_cancel', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by, attendance_phase, attendance_locked)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Finalized', base - interval '1 day 3 hours', base - interval '1 day 2 hours', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'), 'FINALIZED', true)
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_final', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a2'), 'Other department', base + interval '2 days', base + interval '2 days 1 hour', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_a2', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Will move', base - interval '5 hours', base - interval '4 hours', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_move', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Recall', base - interval '1 day 3 hours', base - interval '1 day 2 hours', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_recall', v_id);
  -- Purge sessions.
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Purge retention', base - interval '2 days 3 hours', base - interval '2 days 2 hours', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_ret', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Purge recall close', base - interval '2 days 3 hours', base - interval '2 days 2 hours', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_ret_rc', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Purge recent', base - interval '2 days 3 hours', base - interval '2 days 2 hours', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_ret_recent', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a3'), 'A3 session', base + interval '2 days', base + interval '2 days 1 hour', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_a3', v_id);
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_b'), pg_temp.fx('dept_b1'), 'Org B', base + interval '2 days', base + interval '2 days 1 hour', 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_admin_b'))
  RETURNING id INTO v_id; INSERT INTO rota_fx VALUES ('s_b1', v_id);

  -- Governance + enrolment (org C stays disabled with no governance).
  INSERT INTO public.rota_settings (org_id, enabled, dpia_reference, privacy_notice_confirmed_at, enabled_at)
  VALUES (pg_temp.fx('org_a'), true, 'LAB-DPIA-A', now(), now()),
         (pg_temp.fx('org_b'), true, 'LAB-DPIA-B', now(), now()),
         (pg_temp.fx('org_c'), false, NULL, NULL, NULL);
  INSERT INTO public.rota_departments (department_id, org_id) VALUES
    (pg_temp.fx('dept_a1'), pg_temp.fx('org_a')),
    (pg_temp.fx('dept_a2'), pg_temp.fx('org_a')),
    (pg_temp.fx('dept_a3'), pg_temp.fx('org_a')),
    (pg_temp.fx('dept_b1'), pg_temp.fx('org_b'));

  INSERT INTO rota_fx VALUES
    ('b_same', gen_random_uuid()), ('b1', gen_random_uuid()), ('b2', gen_random_uuid()),
    ('b3', gen_random_uuid()), ('b4', gen_random_uuid()), ('b5', gen_random_uuid()),
    ('b6', gen_random_uuid()), ('b7', gen_random_uuid()), ('b8', gen_random_uuid()),
    ('b9', gen_random_uuid()), ('b10', gen_random_uuid()), ('b11', gen_random_uuid()),
    ('b12', gen_random_uuid()), ('b13', gen_random_uuid()), ('b14', gen_random_uuid()),
    ('b15', gen_random_uuid()), ('b16', gen_random_uuid()), ('b17', gen_random_uuid()),
    ('up1', gen_random_uuid()), ('up1_w', gen_random_uuid()), ('up1_p', gen_random_uuid()),
    ('up1_p2', gen_random_uuid()), ('b18', gen_random_uuid()), ('b19', gen_random_uuid());
END $$;

-- ---------------------------------------------------------------------------
-- L1: anon and authenticated can touch no rota table, view or function.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r text;
  t text;
  f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH t IN ARRAY ARRAY['rota_settings','rota_departments','rota_uploaders','rota_upload_profiles',
                             'rota_identity_links','rota_import_batches','rota_match_previews',
                             'rota_session_flags','rota_visible_session_flags'] LOOP
      PERFORM pg_temp.expect_state(format('SET LOCAL ROLE %I; SELECT 1 FROM public.%I LIMIT 1', r, t), '42501', 'L1 select ' || t || ' as ' || r);
      -- The view is not auto-updatable (joins); SELECT is its only verb.
      CONTINUE WHEN t = 'rota_visible_session_flags';
      PERFORM pg_temp.expect_state(format('SET LOCAL ROLE %I; DELETE FROM public.%I', r, t), '42501', 'L1 delete ' || t || ' as ' || r);
      PERFORM pg_temp.expect_state(format('SET LOCAL ROLE %I; UPDATE public.%I SET org_id = org_id', r, t), '42501', 'L1 update ' || t || ' as ' || r);
    END LOOP;
    PERFORM pg_temp.expect_state(format('SET LOCAL ROLE %I; INSERT INTO public.rota_settings (org_id) VALUES (gen_random_uuid())', r), '42501', 'L1 insert rota_settings as ' || r);
    PERFORM pg_temp.expect_state(format('SET LOCAL ROLE %I; INSERT INTO public.rota_session_flags (session_id) VALUES (gen_random_uuid())', r), '42501', 'L1 insert rota_session_flags as ' || r);
    PERFORM pg_temp.expect_state(format('SET LOCAL ROLE %I; INSERT INTO public.rota_identity_links (org_id) VALUES (gen_random_uuid())', r), '42501', 'L1 insert rota_identity_links as ' || r);
    FOREACH f IN ARRAY ARRAY[
      'SELECT public.rota_is_department_trainee(NULL, NULL, NULL)',
      'SELECT public.purge_rota_data_v1(NULL)',
      'SELECT public.ingest_rota_batch_v1(NULL, NULL, NULL, NULL, NULL, NULL, NULL)',
      'SELECT public.confirm_rota_excusal_v1(NULL, NULL, NULL, NULL)',
      'SELECT public.disable_rota_for_org_v1(NULL, NULL)',
      'SELECT public.rota_apply_identity_link(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)',
      'SELECT public.record_rota_match_preview_v1(NULL, NULL, NULL, NULL, NULL, NULL, NULL)',
      'SELECT public.link_rota_identity_v1(NULL, NULL, NULL, NULL, NULL)',
      'SELECT public.dismiss_rota_suggestion_v1(NULL, NULL, NULL, NULL)',
      'SELECT public.contest_rota_flag_v1(NULL, NULL, NULL)',
      'SELECT public.recall_catchup_eligible_statuses_v1()'
    ] LOOP
      PERFORM pg_temp.expect_state(format('SET LOCAL ROLE %I; %s', r, f), '42501', 'L1 execute as ' || r || ': ' || f);
    END LOOP;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'rota\_%') THEN
    RAISE EXCEPTION 'FAIL L1: a rota table has an RLS policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'rota\_%' AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'FAIL L1: a rota table has RLS disabled';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- L2: enabling without governance is refused by the CHECK.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect_state(
    format('UPDATE public.rota_settings SET enabled = true WHERE org_id = %L', pg_temp.fx('org_c')),
    '23514', 'L2 enable without DPIA/notice');
  PERFORM pg_temp.expect_state(
    format('UPDATE public.rota_settings SET enabled = true, dpia_reference = %L WHERE org_id = %L', 'LAB-1', pg_temp.fx('org_c')),
    '23514', 'L2 enable without notice');
  PERFORM pg_temp.expect_state(
    format('UPDATE public.rota_settings SET privacy_notice_confirmed_at = NULL WHERE org_id = %L', pg_temp.fx('org_a')),
    '23514', 'L2 clear governance while enabled');
END $$;

-- ---------------------------------------------------------------------------
-- L3: another org's department cannot be enrolled.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect_state(
    format('INSERT INTO public.rota_departments (department_id, org_id) VALUES (%L, %L)', pg_temp.fx('dept_b2'), pg_temp.fx('org_a')),
    '23503', 'L3 cross-org department');
  PERFORM pg_temp.expect_state(
    format('INSERT INTO public.rota_uploaders (department_id, org_id, user_id) VALUES (%L, %L, %L)', pg_temp.fx('dept_b1'), pg_temp.fx('org_a'), pg_temp.fx('u_t1')),
    '23503', 'L3 cross-org uploader');
END $$;

-- ---------------------------------------------------------------------------
-- L4: idempotency is per tenant; replay vs conflict.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
  n integer;
BEGIN
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b_same'), 'PLANNED', 'same-a', '[]', '[]');
  IF (v->>'replayed')::boolean THEN RAISE EXCEPTION 'FAIL L4: first org A ingest reported replayed'; END IF;
  PERFORM pg_temp.preview(pg_temp.fx('org_b'), pg_temp.fx('dept_b1'), pg_temp.fx('b_same'), pg_temp.fx('u_admin_b'));
  v := public.ingest_rota_batch_v1(
    pg_temp.fx('org_b'), pg_temp.fx('dept_b1'), pg_temp.fx('u_admin_b'),
    jsonb_build_object('id', pg_temp.fx('b_same'), 'upload_id', pg_temp.fx('b_same'), 'kind', 'PLANNED',
      'payload_digest', encode(sha256(convert_to('same-b', 'UTF8')), 'hex'),
      'range_from', current_date, 'range_to', current_date + 5, 'people_received', 1),
    jsonb_build_array(pg_temp.pair('s_b1', 'u_t_b')), '[]', '[]');
  IF (v->>'replayed')::boolean OR (v->>'flags_inserted')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL L4: org B ingest with the same batch id was not independent: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.rota_import_batches WHERE id = pg_temp.fx('b_same');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL L4: expected two independent batch rows, found %', n; END IF;

  -- Replay with the same hash: no new writes.
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b_same'), 'PLANNED', 'same-a',
                      jsonb_build_array(pg_temp.pair('s_future', 'u_t5')), '[]');
  IF NOT (v->>'replayed')::boolean THEN RAISE EXCEPTION 'FAIL L4: replay not reported: %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t5')) THEN
    RAISE EXCEPTION 'FAIL L4: replay applied flags';
  END IF;

  PERFORM pg_temp.expect_rota(
    format('SELECT pg_temp.ingest(%L, %L, %L::uuid, %L, %L, %L::jsonb, %L::jsonb)',
           'org_a', 'dept_a1', pg_temp.fx('b_same'), 'PLANNED', 'different', '[]', '[]'),
    'batch_conflict', 'L4 different hash');

  -- Disabled org / un-enrolled department.
  PERFORM pg_temp.expect_rota(
    format('SELECT public.ingest_rota_batch_v1(%L, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)',
           pg_temp.fx('org_c'), pg_temp.fx('dept_a1'), pg_temp.fx('u_mod_a'), '{}', '[]', '[]', '[]'),
    'disabled', 'L4 disabled org');

  -- Malformed payloads.
  PERFORM pg_temp.expect_rota(
    format('SELECT public.ingest_rota_batch_v1(%L, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)',
           pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_mod_a'),
           '{"id":"not-a-uuid","kind":"PLANNED"}', '[]', '[]', '[]'),
    'invalid_payload', 'L4 bad uuid');
  PERFORM pg_temp.expect_rota(
    format('SELECT pg_temp.ingest(%L, %L, %L::uuid, %L, %L, %L::jsonb, %L::jsonb)',
           'org_a', 'dept_a1', gen_random_uuid(), 'SOMETIMES', 'x', '[]', '[]'),
    'invalid_payload', 'L4 bad kind');
  PERFORM pg_temp.expect_rota(
    format('SELECT pg_temp.ingest(%L, %L, %L::uuid, %L, %L, %L::jsonb, %L::jsonb)',
           'org_a', 'dept_a1', gen_random_uuid(), 'PLANNED', 'x', '[{"session_id":"nope"}]', '[]'),
    'invalid_payload', 'L4 bad flag row');
  PERFORM pg_temp.expect_rota(
    format('SELECT pg_temp.ingest(%L, %L, %L::uuid, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb)',
           'org_a', 'dept_a1', gen_random_uuid(), 'PLANNED', 'x', '[]', '[]',
           jsonb_build_array(jsonb_build_object('key_type', 'NAME', 'key_hmac', pg_temp.hmac('n'), 'user_id', pg_temp.fx('u_t1'), 'origin', 'MODERATOR'))),
    'invalid_payload', 'L4 NAME link refused');
  PERFORM pg_temp.expect_rota(
    format('SELECT pg_temp.ingest(%L, %L, %L::uuid, %L, %L, %L::jsonb, %L::jsonb)',
           'org_a', 'dept_a1', gen_random_uuid(), 'PLANNED', 'x',
           jsonb_build_array(pg_temp.pair('s_future', 'u_t1')), jsonb_build_array(pg_temp.pair('s_future', 'u_t1'))),
    'invalid_payload', 'L4 pair both flagged and cleared');
  PERFORM pg_temp.expect_rota(
    format('SELECT public.ingest_rota_batch_v1(%L, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)',
           pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_mod_a'),
           jsonb_build_object('id', gen_random_uuid(), 'upload_id', gen_random_uuid(), 'kind', 'PLANNED',
             'payload_digest', repeat('a', 64), 'range_from', current_date + 200, 'range_to', current_date + 210),
           '[]', '[]', '[]'),
    'invalid_payload', 'L4 range beyond horizon');
END $$;

-- ---------------------------------------------------------------------------
-- L4b: an upload is bound to its one preview (by the same caller, same
-- department), at most one batch per kind per upload; the size cap follows
-- sessions, not days.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.batch_json(p_id uuid, p_upload uuid, p_kind text, p_seed text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', p_id, 'upload_id', p_upload, 'kind', p_kind,
    'payload_digest', encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    'range_from', CASE WHEN p_kind = 'WORKED' THEN current_date - 3 ELSE current_date END,
    'range_to', CASE WHEN p_kind = 'WORKED' THEN current_date - 1 ELSE current_date + 5 END,
    'people_received', 1)
$$;

DO $$
DECLARE
  v jsonb;
  v_up uuid := pg_temp.fx('up1');
  v_many jsonb;
BEGIN
  -- No preview recorded for the upload.
  PERFORM pg_temp.expect_rota(
    format('SELECT public.ingest_rota_batch_v1(%L, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)',
           pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_mod_a'),
           pg_temp.batch_json(pg_temp.fx('up1_w'), v_up, 'WORKED', 'up1-w'), '[]', '[]', '[]'),
    'preview_required', 'L4b no preview');
  -- A preview by someone else, or for another department, does not count.
  PERFORM pg_temp.preview(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), v_up, pg_temp.fx('u_admin_a'));
  PERFORM pg_temp.expect_rota(
    format('SELECT public.ingest_rota_batch_v1(%L, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)',
           pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_mod_a'),
           pg_temp.batch_json(pg_temp.fx('up1_w'), v_up, 'WORKED', 'up1-w'), '[]', '[]', '[]'),
    'preview_required', 'L4b preview by another caller');
  PERFORM pg_temp.expect_rota(
    format('SELECT public.ingest_rota_batch_v1(%L, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)',
           pg_temp.fx('org_a'), pg_temp.fx('dept_a2'), pg_temp.fx('u_admin_a'),
           pg_temp.batch_json(pg_temp.fx('up1_w'), v_up, 'WORKED', 'up1-w'), '[]', '[]', '[]'),
    'preview_required', 'L4b preview for another department');

  -- The previewing caller: one WORKED and one PLANNED batch, then no more.
  v := public.ingest_rota_batch_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_admin_a'),
         pg_temp.batch_json(pg_temp.fx('up1_w'), v_up, 'WORKED', 'up1-w'), '[]', '[]', '[]');
  v := public.ingest_rota_batch_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_admin_a'),
         pg_temp.batch_json(pg_temp.fx('up1_p'), v_up, 'PLANNED', 'up1-p'), '[]', '[]', '[]');
  IF (v->>'replayed')::boolean THEN RAISE EXCEPTION 'FAIL L4b: PLANNED reported replayed'; END IF;
  -- A replay of the same batch is fine; a second PLANNED batch for the upload is not.
  v := public.ingest_rota_batch_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_admin_a'),
         pg_temp.batch_json(pg_temp.fx('up1_p'), v_up, 'PLANNED', 'up1-p'), '[]', '[]', '[]');
  IF NOT (v->>'replayed')::boolean THEN RAISE EXCEPTION 'FAIL L4b: replay not reported'; END IF;
  PERFORM pg_temp.expect_rota(
    format('SELECT public.ingest_rota_batch_v1(%L, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)',
           pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_admin_a'),
           pg_temp.batch_json(pg_temp.fx('up1_p2'), v_up, 'PLANNED', 'up1-p2'), '[]', '[]', '[]'),
    'batch_conflict', 'L4b second PLANNED batch for one upload');
  -- The replay must also name the same upload.
  PERFORM pg_temp.expect_rota(
    format('SELECT pg_temp.ingest(%L, %L, %L::uuid, %L, %L, %L::jsonb, %L::jsonb)',
           'org_a', 'dept_a1', pg_temp.fx('up1_p'), 'PLANNED', 'up1-p', '[]', '[]'),
    'batch_conflict', 'L4b same batch id under another upload');

  -- Size: 501 rows on one session is refused; 4,600 rows over ten (unknown)
  -- sessions is not (the old days-based cap for this 9-day range was 4,500).
  SELECT jsonb_agg(pg_temp.pair('s_future', 'u_t1')) INTO v_many FROM generate_series(1, 501);
  PERFORM pg_temp.expect_rota(
    format('SELECT pg_temp.ingest(%L, %L, %L::uuid, %L, %L, %L::jsonb, %L::jsonb)',
           'org_a', 'dept_a1', gen_random_uuid(), 'PLANNED', 'cap-1', v_many::text, '[]'),
    'invalid_payload', 'L4b 501 rows on one session');
  SELECT jsonb_agg(jsonb_build_object('session_id', sid, 'user_id', gen_random_uuid())) INTO v_many
  FROM (SELECT gen_random_uuid() AS sid FROM generate_series(1, 10)) s, generate_series(1, 460);
  v := pg_temp.ingest('org_a', 'dept_a1', gen_random_uuid(), 'PLANNED', 'cap-2', v_many, '[]');
  IF (v->>'rows_rejected')::int <> 4600 THEN RAISE EXCEPTION 'FAIL L4b: large batch %', v; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- L14: the match-preview gate (one per upload, ≤ 10 per uploader per day).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_up uuid := gen_random_uuid();
  r text;
  i integer;
BEGIN
  r := public.record_rota_match_preview_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), v_up, pg_temp.fx('u_fac'), 'UPLOADER', 3, 10);
  IF r <> 'recorded' THEN RAISE EXCEPTION 'FAIL L14: first preview %', r; END IF;
  r := public.record_rota_match_preview_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), v_up, pg_temp.fx('u_mod_a'), 'MODERATOR', 3, 10);
  IF r <> 'duplicate' THEN RAISE EXCEPTION 'FAIL L14: duplicate upload id %', r; END IF;
  FOR i IN 2..10 LOOP
    r := public.record_rota_match_preview_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), gen_random_uuid(), pg_temp.fx('u_fac'), 'UPLOADER', 1, 10);
    IF r <> 'recorded' THEN RAISE EXCEPTION 'FAIL L14: preview % was %', i, r; END IF;
  END LOOP;
  r := public.record_rota_match_preview_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), gen_random_uuid(), pg_temp.fx('u_fac'), 'UPLOADER', 1, 10);
  IF r <> 'rate_limited' THEN RAISE EXCEPTION 'FAIL L14: eleventh preview was %', r; END IF;
  IF (SELECT count(*) FROM public.rota_match_previews WHERE caller_user_id = pg_temp.fx('u_fac')) <> 10 THEN
    RAISE EXCEPTION 'FAIL L14: a rate-limited preview was recorded';
  END IF;
  -- Moderators are not rate-limited.
  r := public.record_rota_match_preview_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), gen_random_uuid(), pg_temp.fx('u_fac'), 'MODERATOR', 1, 10);
  IF r <> 'recorded' THEN RAISE EXCEPTION 'FAIL L14: moderator preview %', r; END IF;
  PERFORM pg_temp.expect_rota(
    format('SELECT public.record_rota_match_preview_v1(%L, %L, %L, %L, %L, 501, 10)',
           pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), gen_random_uuid(), pg_temp.fx('u_fac'), 'UPLOADER'),
    'invalid_payload', 'L14 over 500 people');
END $$;

-- ---------------------------------------------------------------------------
-- L5a–e: precedence table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
  f public.rota_session_flags%ROWTYPE;
BEGIN
  -- (a) none → OPEN
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b1'), 'PLANNED', 'b1',
         jsonb_build_array(pg_temp.pair('s_future', 'u_t1'), pg_temp.pair('s_future', 'u_t2')), '[]');
  IF (v->>'flags_inserted')::int <> 2 THEN RAISE EXCEPTION 'FAIL L5a: %', v; END IF;
  SELECT * INTO f FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t1');
  IF f.state <> 'OPEN' OR f.kind <> 'PLANNED' OR f.batch_id <> pg_temp.fx('b1')
     OR f.expires_at <> (SELECT date_end + interval '90 days' FROM public.sessions WHERE id = pg_temp.fx('s_future'))
     OR f.session_date_start <> (SELECT date_start FROM public.sessions WHERE id = pg_temp.fx('s_future')) THEN
    RAISE EXCEPTION 'FAIL L5a: unexpected flag row';
  END IF;

  -- (b) OPEN PLANNED + WORKED → replaced; OPEN PLANNED + later PLANNED → replaced
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b2'), 'WORKED', 'b2',
         jsonb_build_array(pg_temp.pair('s_future', 'u_t1')), '[]');
  SELECT * INTO f FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t1');
  IF f.kind <> 'WORKED' OR f.batch_id <> pg_temp.fx('b2') OR (v->>'flags_replaced')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL L5b: WORKED did not replace PLANNED: %', v;
  END IF;
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b3'), 'PLANNED', 'b3',
         jsonb_build_array(pg_temp.pair('s_future', 'u_t2')), '[]');
  SELECT * INTO f FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t2');
  IF f.kind <> 'PLANNED' OR f.batch_id <> pg_temp.fx('b3') THEN
    RAISE EXCEPTION 'FAIL L5b: later PLANNED did not replace PLANNED';
  END IF;

  -- (c) OPEN WORKED + PLANNED → ignored
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b4'), 'PLANNED', 'b4',
         jsonb_build_array(pg_temp.pair('s_future', 'u_t1')), '[]');
  SELECT * INTO f FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t1');
  IF f.kind <> 'WORKED' OR f.batch_id <> pg_temp.fx('b2') THEN
    RAISE EXCEPTION 'FAIL L5c: PLANNED overwrote WORKED';
  END IF;

  -- (d) OPEN + cleared → deleted; OPEN WORKED + PLANNED-cleared → kept
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b5'), 'PLANNED', 'b5', '[]',
         jsonb_build_array(pg_temp.pair('s_future', 'u_t1'), pg_temp.pair('s_future', 'u_t2')));
  IF EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t2')) THEN
    RAISE EXCEPTION 'FAIL L5d: cleared OPEN PLANNED flag kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t1') AND kind = 'WORKED') THEN
    RAISE EXCEPTION 'FAIL L5d: PLANNED-cleared removed an OPEN WORKED flag';
  END IF;
  IF (v->>'flags_deleted')::int <> 1 THEN RAISE EXCEPTION 'FAIL L5d: flags_deleted %', v; END IF;

  -- (e) decided rows are never rewritten; rota_changed_at marks disagreement
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b6'), 'PLANNED', 'b6',
         jsonb_build_array(pg_temp.pair('s_future', 'u_t3'), pg_temp.pair('s_future', 'u_t4'), pg_temp.pair('s_future', 'u_t5')), '[]');
  UPDATE public.rota_session_flags SET state = 'CONFIRMED', decided_at = now(), decided_by = pg_temp.fx('u_mod_a')
  WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t3');
  UPDATE public.rota_session_flags SET state = 'DISMISSED', decided_at = now(), decided_by = pg_temp.fx('u_mod_a')
  WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t4');
  UPDATE public.rota_session_flags SET state = 'CONTESTED', contested_at = now()
  WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t5');

  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b7'), 'PLANNED', 'b7', '[]',
         jsonb_build_array(pg_temp.pair('s_future', 'u_t3'), pg_temp.pair('s_future', 'u_t4'), pg_temp.pair('s_future', 'u_t5')));
  IF (v->>'decided_marked_changed')::int <> 3 OR (v->>'flags_deleted')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL L5e: decided rows not marked: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_session_flags
             WHERE session_id = pg_temp.fx('s_future') AND user_id IN (pg_temp.fx('u_t3'), pg_temp.fx('u_t4'), pg_temp.fx('u_t5'))
               AND (rota_changed_at IS NULL OR batch_id <> pg_temp.fx('b6') OR state = 'OPEN')) THEN
    RAISE EXCEPTION 'FAIL L5e: a decided row was rewritten or not marked';
  END IF;
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b8'), 'PLANNED', 'b8',
         jsonb_build_array(pg_temp.pair('s_future', 'u_t3'), pg_temp.pair('s_future', 'u_t4'), pg_temp.pair('s_future', 'u_t5')), '[]');
  IF (v->>'decided_unmarked')::int <> 3 THEN RAISE EXCEPTION 'FAIL L5e: not unmarked: %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.rota_session_flags
             WHERE session_id = pg_temp.fx('s_future') AND user_id IN (pg_temp.fx('u_t3'), pg_temp.fx('u_t4'), pg_temp.fx('u_t5'))
               AND (rota_changed_at IS NOT NULL OR batch_id <> pg_temp.fx('b6'))) THEN
    RAISE EXCEPTION 'FAIL L5e: unavailable-again did not clear rota_changed_at, or rewrote the row';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- L5f: rows for non-trainees and ineligible sessions are rejected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
BEGIN
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b9'), 'PLANNED', 'b9',
         jsonb_build_array(
           pg_temp.pair('s_future', 'u_fac'),     -- faculty, not a trainee
           pg_temp.pair('s_future', 'u_t6'),      -- trainee of A2 only
           pg_temp.pair('s_v1', 'u_t1'),          -- policy v1
           pg_temp.pair('s_cancel', 'u_t1'),      -- cancelled
           pg_temp.pair('s_draft', 'u_t1'),       -- draft (not published)
           pg_temp.pair('s_final', 'u_t1'),       -- finalized
           pg_temp.pair('s_a2', 'u_t6'),          -- another department's session
           pg_temp.pair('s_b1', 'u_t_b')),        -- another org's session
         jsonb_build_array(pg_temp.pair('s_v1', 'u_t2')));
  IF (v->>'rows_rejected')::int <> 9 OR (v->>'flags_inserted')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL L5f: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_session_flags WHERE batch_id = pg_temp.fx('b9')) THEN
    RAISE EXCEPTION 'FAIL L5f: a rejected row was written';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- L5g: identity links — trainee-only, anti-hijack across enrolled departments.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
BEGIN
  -- A2 links K1 to its trainee T6.
  v := pg_temp.ingest('org_a', 'dept_a2', pg_temp.fx('b10'), 'PLANNED', 'b10', '[]', '[]',
         jsonb_build_array(jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('K1'), 'user_id', pg_temp.fx('u_t6'), 'origin', 'MODERATOR')));
  IF (v->>'links_upserted')::int <> 1 THEN RAISE EXCEPTION 'FAIL L5g: A2 link not stored: %', v; END IF;

  -- A1 cannot take K1 from a current trainee of A2; cannot link a non-trainee;
  -- can link its own trainees; can move K2 between its own trainees.
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b11'), 'PLANNED', 'b11', '[]', '[]',
         jsonb_build_array(
           jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('K1'), 'user_id', pg_temp.fx('u_t1'), 'origin', 'MODERATOR'),
           jsonb_build_object('key_type', 'EMAIL', 'key_hmac', pg_temp.hmac('K3'), 'user_id', pg_temp.fx('u_fac'), 'origin', 'MODERATOR'),
           jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('K2'), 'user_id', pg_temp.fx('u_t1'), 'origin', 'EMAIL_MATCH')));
  IF (v->>'links_refused')::int <> 2 OR (v->>'links_upserted')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL L5g: %', v;
  END IF;
  IF (SELECT user_id FROM public.rota_identity_links WHERE org_id = pg_temp.fx('org_a') AND key_type = 'STAFF_ID' AND key_hmac = pg_temp.hmac('K1')) <> pg_temp.fx('u_t6') THEN
    RAISE EXCEPTION 'FAIL L5g: K1 was hijacked';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_identity_links WHERE key_hmac = pg_temp.hmac('K3')) THEN
    RAISE EXCEPTION 'FAIL L5g: a non-trainee was linked';
  END IF;

  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b12'), 'PLANNED', 'b12', '[]', '[]',
         jsonb_build_array(jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('K2'), 'user_id', pg_temp.fx('u_t2'), 'origin', 'MODERATOR')));
  IF (SELECT user_id FROM public.rota_identity_links WHERE org_id = pg_temp.fx('org_a') AND key_type = 'STAFF_ID' AND key_hmac = pg_temp.hmac('K2')) <> pg_temp.fx('u_t2')
     OR (SELECT origin FROM public.rota_identity_links WHERE org_id = pg_temp.fx('org_a') AND key_type = 'STAFF_ID' AND key_hmac = pg_temp.hmac('K2')) <> 'MODERATOR' THEN
    RAISE EXCEPTION 'FAIL L5g: own-department relink refused: %', v;
  END IF;
  -- The same HMAC in another org is a different key.
  IF EXISTS (SELECT 1 FROM public.rota_identity_links WHERE org_id = pg_temp.fx('org_b')) THEN
    RAISE EXCEPTION 'FAIL L5g: a link leaked into org B';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- L5h: a moderator links a trainee by staff number (same rules as ingest).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.link_rota_identity_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_mod_a'), pg_temp.fx('u_t3'),
         jsonb_build_array(jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('K9')),
                           jsonb_build_object('key_type', 'EMAIL', 'key_hmac', pg_temp.hmac('E9'))));
  IF (v->>'linked')::int <> 2 OR (v->>'refused')::int <> 0 THEN RAISE EXCEPTION 'FAIL L5h: %', v; END IF;
  IF (SELECT origin FROM public.rota_identity_links WHERE org_id = pg_temp.fx('org_a') AND key_hmac = pg_temp.hmac('K9')) <> 'MODERATOR'
     OR (SELECT confirmed_by FROM public.rota_identity_links WHERE org_id = pg_temp.fx('org_a') AND key_hmac = pg_temp.hmac('K9')) <> pg_temp.fx('u_mod_a') THEN
    RAISE EXCEPTION 'FAIL L5h: link not stored as a moderator link';
  END IF;
  -- K1 belongs to a current trainee of enrolled A2: refused, not moved.
  v := public.link_rota_identity_v1(pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('u_mod_a'), pg_temp.fx('u_t1'),
         jsonb_build_array(jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('K1'))));
  IF (v->>'linked')::int <> 0 OR (v->>'refused')::int <> 1 THEN RAISE EXCEPTION 'FAIL L5h: hijack %', v; END IF;
  PERFORM pg_temp.expect_rota(
    format('SELECT public.link_rota_identity_v1(%L, %L, %L, %L, %L::jsonb)', pg_temp.fx('org_a'), pg_temp.fx('dept_a1'),
           pg_temp.fx('u_mod_a'), pg_temp.fx('u_fac'), jsonb_build_array(jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('K8')))),
    'not_eligible', 'L5h non-trainee');
  PERFORM pg_temp.expect_rota(
    format('SELECT public.link_rota_identity_v1(%L, %L, %L, %L, %L::jsonb)', pg_temp.fx('org_a'), pg_temp.fx('dept_a1'),
           pg_temp.fx('u_mod_a'), pg_temp.fx('u_t3'), jsonb_build_array(jsonb_build_object('key_type', 'NAME', 'key_hmac', pg_temp.hmac('N')))),
    'invalid_payload', 'L5h NAME key');
  PERFORM pg_temp.expect_rota(
    format('SELECT public.link_rota_identity_v1(%L, %L, %L, %L, %L::jsonb)', pg_temp.fx('org_c'), pg_temp.fx('dept_a1'),
           pg_temp.fx('u_mod_a'), pg_temp.fx('u_t3'), jsonb_build_array(jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('K7')))),
    'disabled', 'L5h disabled org');
END $$;

-- ---------------------------------------------------------------------------
-- L7: transactional confirm (L7c, the concurrent case, runs in the runner).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
  a public.attendance%ROWTYPE;
  n integer;
  ev public.attendance_evidence%ROWTYPE;
  v_batch uuid := pg_temp.fx('b13');
BEGIN
  v := pg_temp.ingest('org_a', 'dept_a1', v_batch, 'WORKED', 'b13',
         jsonb_build_array(pg_temp.pair('s_past', 'u_t1'), pg_temp.pair('s_past', 'u_t2'), pg_temp.pair('s_past', 'u_t3'),
                           pg_temp.pair('s_past', 'u_t5'), pg_temp.pair('s_past', 'u_t8'), pg_temp.pair('s_move', 'u_t4')), '[]');
  IF (v->>'flags_inserted')::int <> 6 THEN RAISE EXCEPTION 'FAIL L7 setup: %', v; END IF;

  -- (a) before date_end
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_future'), pg_temp.fx('u_t1'), pg_temp.fx('u_mod_a')),
    'not_confirmable', 'L7a');

  -- (b) after the end
  a := public.confirm_rota_excusal_v1(pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t1'), pg_temp.fx('u_mod_a'));
  IF a.status <> 'EXCUSED' OR a.primary_source <> 'MODERATOR_CONFIRMATION' THEN
    RAISE EXCEPTION 'FAIL L7b: attendance % %', a.status, a.primary_source;
  END IF;
  SELECT count(*) INTO n FROM public.attendance_evidence
  WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t1') AND source = 'MODERATOR_CONFIRMATION';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL L7b: % moderator rows', n; END IF;
  SELECT * INTO ev FROM public.attendance_evidence
  WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t1') AND source = 'MODERATOR_CONFIRMATION';
  IF ev.metadata->>'reason_code' <> 'ROTA_UNAVAILABLE'
     OR ev.metadata->>'status_override' <> 'EXCUSED'
     OR (ev.metadata->>'rota_batch_id')::uuid <> v_batch
     OR ev.metadata ? 'category'
     OR ev.correction_reason <> 'Rostered unavailable (rota)'
     OR ev.source_event_key <> 'ROTA_EXCUSAL:' || pg_temp.fx('s_past') || ':' || pg_temp.fx('u_t1') || ':0' THEN
    RAISE EXCEPTION 'FAIL L7b: evidence row %', ev.metadata;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t1')
                 AND state = 'CONFIRMED' AND decided_by = pg_temp.fx('u_mod_a') AND decided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL L7b: flag not CONFIRMED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.session_activity_events WHERE session_id = pg_temp.fx('s_past')
                 AND event_type = 'ROTA_EXCUSAL_CONFIRMED' AND subject_user_id = pg_temp.fx('u_t1')
                 AND details->>'batch_id' = v_batch::text) THEN
    RAISE EXCEPTION 'FAIL L7b: activity event missing';
  END IF;
  -- A sequential double click.
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t1'), pg_temp.fx('u_mod_a')),
    'suggestion_changed', 'L7b double click');
  SELECT count(*) INTO n FROM public.attendance_evidence
  WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t1') AND source = 'MODERATOR_CONFIRMATION';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL L7b: double click wrote % rows', n; END IF;

  -- (d) presence evidence (valid self check-in) blocks and leaves the flag OPEN
  PERFORM public.record_attendance_evidence_v2(
    pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t2'), NULL,
    'SELF_CHECKIN', (SELECT date_start FROM public.sessions WHERE id = pg_temp.fx('s_past')),
    '{}'::jsonb, pg_temp.fx('u_t2'), 'lab-checkin-t2', NULL);
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t2'), pg_temp.fx('u_mod_a')),
    'presence_evidence', 'L7d');
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t2') AND state = 'OPEN') THEN
    RAISE EXCEPTION 'FAIL L7d: flag left the OPEN state';
  END IF;

  -- An assigned-teacher TEACHER row is not presence evidence (L7d variant).
  INSERT INTO public.session_participants (org_id, department_id, session_id, user_id, participant_role, expectation)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('s_past'), pg_temp.fx('u_t5'), 'ATTENDEE', 'OPTIONAL')
  ON CONFLICT DO NOTHING;
  PERFORM public.record_attendance_evidence_v2(
    pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t5'), NULL,
    'TEACHER', now(), '{"assigned_as_teacher": true}'::jsonb, pg_temp.fx('u_mod_a'), 'lab-teacher-t5', NULL);

  -- (e) an existing moderator decision
  PERFORM public.record_attendance_evidence_v2(
    pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t3'), NULL,
    'MODERATOR_CONFIRMATION', now(), '{"status_override": "ABSENT"}'::jsonb, pg_temp.fx('u_mod_a'), 'lab-mc-t3', 'Manual decision');
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t3'), pg_temp.fx('u_mod_a')),
    'already_decided', 'L7e');
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t3') AND state = 'OPEN') THEN
    RAISE EXCEPTION 'FAIL L7e: flag left the OPEN state';
  END IF;

  -- (f) policy v1 and (g) finalized: flags inserted directly for the check.
  INSERT INTO public.rota_session_flags (session_id, user_id, org_id, department_id, kind, as_of, batch_id,
                                         session_date_start, session_date_end, expires_at)
  SELECT s.id, pg_temp.fx('u_t4'), s.org_id, s.department_id, 'WORKED', now(), v_batch, s.date_start, s.date_end, s.date_end + interval '90 days'
  FROM public.sessions s WHERE s.id IN (pg_temp.fx('s_v1'), pg_temp.fx('s_final'));
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_v1'), pg_temp.fx('u_t4'), pg_temp.fx('u_mod_a')),
    'not_confirmable', 'L7f');
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_final'), pg_temp.fx('u_t4'), pg_temp.fx('u_mod_a')),
    'not_confirmable', 'L7g');

  -- (h) the session moved after the flag was computed
  UPDATE public.sessions SET date_start = date_start - interval '10 minutes' WHERE id = pg_temp.fx('s_move');
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_move'), pg_temp.fx('u_t4'), pg_temp.fx('u_mod_a')),
    'suggestion_changed', 'L7h');

  -- not a trainee any more / other org / unknown session
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_fac'), pg_temp.fx('u_mod_a')),
    'not_eligible', 'L7 non-trainee');
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_b'), pg_temp.fx('s_past'), pg_temp.fx('u_t5'), pg_temp.fx('u_admin_b')),
    'not_found', 'L7 cross-org');

  -- (i) org disabled (rolled back with a private sub-block)
  BEGIN
    UPDATE public.rota_settings SET enabled = false WHERE org_id = pg_temp.fx('org_a');
    PERFORM pg_temp.expect_rota(
      format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t5'), pg_temp.fx('u_mod_a')),
      'disabled', 'L7i');
    RAISE EXCEPTION USING ERRCODE = 'RB001', MESSAGE = 'undo L7i';
  EXCEPTION WHEN SQLSTATE 'RB001' THEN NULL;
  END;
  IF NOT (SELECT enabled FROM public.rota_settings WHERE org_id = pg_temp.fx('org_a')) THEN
    RAISE EXCEPTION 'FAIL L7i: setup leaked';
  END IF;

  -- Assigned-teacher evidence did not block T5.
  a := public.confirm_rota_excusal_v1(pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t5'), pg_temp.fx('u_mod_a'));
  IF a.status <> 'EXCUSED' THEN RAISE EXCEPTION 'FAIL L7d: assigned-teacher evidence blocked the confirm'; END IF;

  -- (j) a completed catch-up (reopen after RECALL) refuses the confirm and
  -- leaves the flag OPEN. RECALL rows are normally produced only by
  -- complete_recall_catchup_v2; the producer guard is lifted for this row.
  ALTER TABLE public.attendance_evidence DISABLE TRIGGER attendance_recall_evidence_producer;
  INSERT INTO public.attendance_evidence (org_id, session_id, department_id, user_id, source, observed_at, metadata, created_by, source_event_key)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('dept_a1'), pg_temp.fx('u_t8'), 'RECALL', now(),
          '{"status_override": "PRESENT", "method": "AUDIO_RECAP_CATCH_UP"}'::jsonb, pg_temp.fx('u_t8'), 'lab-recall-t8');
  ALTER TABLE public.attendance_evidence ENABLE TRIGGER attendance_recall_evidence_producer;
  PERFORM pg_temp.expect_rota(
    format('SELECT public.confirm_rota_excusal_v1(%L, %L, %L, %L)', pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t8'), pg_temp.fx('u_mod_a')),
    'caught_up', 'L7j');
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t8') AND state = 'OPEN') THEN
    RAISE EXCEPTION 'FAIL L7j: flag left the OPEN state';
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_evidence WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t8') AND source = 'MODERATOR_CONFIRMATION') THEN
    RAISE EXCEPTION 'FAIL L7j: an excusal was written over the catch-up';
  END IF;

  -- (k) dismiss and contest: one conditional move each, with a lasting
  -- activity event; a second call, or a moved session, changes nothing.
  IF NOT public.dismiss_rota_suggestion_v1(pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t2'), pg_temp.fx('u_mod_a')) THEN
    RAISE EXCEPTION 'FAIL L7k: dismiss did not move the flag';
  END IF;
  IF public.dismiss_rota_suggestion_v1(pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t2'), pg_temp.fx('u_mod_a')) THEN
    RAISE EXCEPTION 'FAIL L7k: a second dismiss moved a flag';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_past') AND user_id = pg_temp.fx('u_t2')
                 AND state = 'DISMISSED' AND decided_by = pg_temp.fx('u_mod_a') AND decided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL L7k: flag not DISMISSED';
  END IF;
  IF (SELECT count(*) FROM public.session_activity_events WHERE session_id = pg_temp.fx('s_past')
      AND event_type = 'ROTA_SUGGESTION_DISMISSED' AND subject_user_id = pg_temp.fx('u_t2')
      AND actor_user_id = pg_temp.fx('u_mod_a') AND details->>'batch_id' = v_batch::text AND NOT details ? 'category') <> 1 THEN
    RAISE EXCEPTION 'FAIL L7k: dismissal event missing or duplicated';
  END IF;
  IF NOT public.contest_rota_flag_v1(pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t3')) THEN
    RAISE EXCEPTION 'FAIL L7k: contest did not move the flag';
  END IF;
  IF public.contest_rota_flag_v1(pg_temp.fx('org_a'), pg_temp.fx('s_past'), pg_temp.fx('u_t3')) THEN
    RAISE EXCEPTION 'FAIL L7k: a second contest moved a flag';
  END IF;
  IF (SELECT count(*) FROM public.session_activity_events WHERE session_id = pg_temp.fx('s_past')
      AND event_type = 'ROTA_FLAG_CONTESTED' AND subject_user_id = pg_temp.fx('u_t3') AND actor_user_id = pg_temp.fx('u_t3')) <> 1 THEN
    RAISE EXCEPTION 'FAIL L7k: contest event missing or duplicated';
  END IF;
  -- s_move moved in (h): its flag no longer matches, so nothing moves.
  IF public.dismiss_rota_suggestion_v1(pg_temp.fx('org_a'), pg_temp.fx('s_move'), pg_temp.fx('u_t4'), pg_temp.fx('u_mod_a')) THEN
    RAISE EXCEPTION 'FAIL L7k: dismissed a flag whose session moved';
  END IF;
  -- Another organisation cannot touch the flag.
  IF public.contest_rota_flag_v1(pg_temp.fx('org_b'), pg_temp.fx('s_past'), pg_temp.fx('u_t8')) THEN
    RAISE EXCEPTION 'FAIL L7k: cross-org contest moved a flag';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- L13 + L8: the view hides, then the purge deletes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
  n integer;
  v_batch uuid := pg_temp.fx('b14');
  v_a3_batch uuid := pg_temp.fx('b15');
BEGIN
  -- Flags for: retention-elapsed, recall-close-kept, recent-kept (sessions
  -- finalized below), user to be removed (T7), the A3 department.
  v := pg_temp.ingest('org_a', 'dept_a1', v_batch, 'WORKED', 'b14',
         jsonb_build_array(pg_temp.pair('s_ret', 'u_t1'), pg_temp.pair('s_ret_rc', 'u_t1'), pg_temp.pair('s_ret_recent', 'u_t1'),
                           pg_temp.pair('s_future', 'u_t7')), '[]',
         jsonb_build_array(jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('T7'), 'user_id', pg_temp.fx('u_t7'), 'origin', 'MODERATOR'),
                           jsonb_build_object('key_type', 'STAFF_ID', 'key_hmac', pg_temp.hmac('T8'), 'user_id', pg_temp.fx('u_t8'), 'origin', 'MODERATOR')));
  IF (v->>'flags_inserted')::int <> 4 OR (v->>'links_upserted')::int <> 2 THEN RAISE EXCEPTION 'FAIL L8 setup: %', v; END IF;
  v := pg_temp.ingest('org_a', 'dept_a3', v_a3_batch, 'PLANNED', 'b15',
         jsonb_build_array(pg_temp.pair('s_a3', 'u_t8')), '[]');
  IF (v->>'flags_inserted')::int <> 1 THEN RAISE EXCEPTION 'FAIL L8 setup A3: %', v; END IF;

  -- Expired flag (direct insert).
  INSERT INTO public.rota_session_flags (session_id, user_id, org_id, department_id, kind, as_of, batch_id,
                                         session_date_start, session_date_end, expires_at)
  SELECT s.id, pg_temp.fx('u_t2'), s.org_id, s.department_id, 'PLANNED', now(), v_batch, s.date_start, s.date_end, now() - interval '1 second'
  FROM public.sessions s WHERE s.id = pg_temp.fx('s_future')
  ON CONFLICT (session_id, user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at;

  -- Finalize the retention sessions and backdate.
  UPDATE public.sessions SET attendance_phase = 'FINALIZED', attendance_locked = true,
         attendance_finalized_at = now() - interval '31 days'
  WHERE id IN (pg_temp.fx('s_ret'), pg_temp.fx('s_ret_rc'));
  UPDATE public.sessions SET attendance_phase = 'FINALIZED', attendance_locked = true,
         attendance_finalized_at = now() - interval '10 days'
  WHERE id = pg_temp.fx('s_ret_recent');
  INSERT INTO public.recall_question_sets (org_id, session_id, questions, status, revision, catchup_opens_at, catchup_closes_at)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('s_ret_rc'), '[]'::jsonb, 'approved', 1, now() - interval '40 days', now() - interval '5 days');

  -- Cancel / move: s_past (T1 CONFIRMED, T2/T3 OPEN, T5 CONFIRMED) is moved;
  -- s_cancel gets a direct flag then the session is cancelled.
  INSERT INTO public.rota_session_flags (session_id, user_id, org_id, department_id, kind, as_of, batch_id,
                                         session_date_start, session_date_end, expires_at)
  SELECT s.id, pg_temp.fx('u_t3'), s.org_id, s.department_id, 'PLANNED', now(), v_batch, s.date_start, s.date_end, s.date_end + interval '90 days'
  FROM public.sessions s WHERE s.id = pg_temp.fx('s_cancel');
  UPDATE public.sessions SET date_end = date_end + interval '15 minutes' WHERE id = pg_temp.fx('s_past');

  -- T7 leaves A1 (their only department): flag + link must go.
  DELETE FROM public.department_members WHERE department_id = pg_temp.fx('dept_a1') AND user_id = pg_temp.fx('u_t7');

  -- A3 un-enrolled: its flag must go; T8 is still a trainee of enrolled A1, so the T8 link stays.
  DELETE FROM public.rota_departments WHERE department_id = pg_temp.fx('dept_a3');

  -- Old audit rows and an uploader who left the org.
  INSERT INTO public.rota_import_batches (id, org_id, department_id, upload_id, kind, payload_digest, range_from, range_to, created_at)
  VALUES (pg_temp.fx('b16'), pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), gen_random_uuid(), 'PLANNED', repeat('b', 64),
          current_date - 400, current_date - 390, now() - interval '13 months');
  INSERT INTO public.rota_match_previews (org_id, department_id, upload_id, caller_user_id, caller_role, people_count, created_at)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('b18'), pg_temp.fx('u_mod_a'), 'MODERATOR', 3, now() - interval '13 months'),
         (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), pg_temp.fx('b19'), pg_temp.fx('u_mod_a'), 'MODERATOR', 3, now() - interval '1 month');
  INSERT INTO public.rota_uploaders (department_id, org_id, user_id) VALUES
    (pg_temp.fx('dept_a1'), pg_temp.fx('org_a'), pg_temp.fx('u_outsider')),
    (pg_temp.fx('dept_a1'), pg_temp.fx('org_a'), pg_temp.fx('u_fac'));

  -- L13: the view already hides expired, moved, non-trainee and un-enrolled flags.
  IF EXISTS (SELECT 1 FROM public.rota_visible_session_flags
             WHERE (session_id = pg_temp.fx('s_future') AND user_id IN (pg_temp.fx('u_t2'), pg_temp.fx('u_t7')))
                OR session_id IN (pg_temp.fx('s_past'), pg_temp.fx('s_a3'), pg_temp.fx('s_cancel'))) THEN
    RAISE EXCEPTION 'FAIL L13: the view shows a hidden flag';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rota_visible_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t1')) THEN
    RAISE EXCEPTION 'FAIL L13: the view hides a live flag';
  END IF;
  BEGIN
    UPDATE public.rota_settings SET enabled = false WHERE org_id = pg_temp.fx('org_a');
    IF EXISTS (SELECT 1 FROM public.rota_visible_session_flags WHERE org_id = pg_temp.fx('org_a')) THEN
      RAISE EXCEPTION 'FAIL L13: the view shows flags of a disabled org';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'RB001', MESSAGE = 'undo L13';
  EXCEPTION WHEN SQLSTATE 'RB001' THEN NULL;
  END;

  v := public.purge_rota_data_v1(pg_temp.fx('org_a'));
  IF (v->>'flags_expired')::int < 1 OR (v->>'flags_moved')::int < 4 OR (v->>'flags_cancelled')::int < 1
     OR (v->>'flags_not_trainee')::int < 1 OR (v->>'flags_disabled')::int < 1 OR (v->>'flags_retention')::int <> 1
     OR (v->>'links')::int < 1 OR (v->>'uploaders')::int <> 1 OR (v->>'batches')::int <> 1 OR (v->>'previews')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL L8: purge counts %', v;
  END IF;

  IF EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_future') AND user_id = pg_temp.fx('u_t2')) THEN
    RAISE EXCEPTION 'FAIL L8: expired flag kept';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_ret')) THEN
    RAISE EXCEPTION 'FAIL L8: retention-elapsed flag kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_ret_rc')) THEN
    RAISE EXCEPTION 'FAIL L8: flag purged before Recall close + retention';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id = pg_temp.fx('s_ret_recent')) THEN
    RAISE EXCEPTION 'FAIL L8: flag purged inside retention';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_session_flags WHERE session_id IN (pg_temp.fx('s_cancel'), pg_temp.fx('s_past'), pg_temp.fx('s_a3'))) THEN
    RAISE EXCEPTION 'FAIL L8: cancelled/moved/un-enrolled flag kept';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_session_flags WHERE user_id = pg_temp.fx('u_t7')) THEN
    RAISE EXCEPTION 'FAIL L8: removed member flag kept';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_identity_links WHERE user_id = pg_temp.fx('u_t7')) THEN
    RAISE EXCEPTION 'FAIL L8: leaver link kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rota_identity_links WHERE user_id = pg_temp.fx('u_t8')) THEN
    RAISE EXCEPTION 'FAIL L8: link of a current trainee purged';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_uploaders WHERE user_id = pg_temp.fx('u_outsider'))
     OR NOT EXISTS (SELECT 1 FROM public.rota_uploaders WHERE user_id = pg_temp.fx('u_fac')) THEN
    RAISE EXCEPTION 'FAIL L8: uploader purge wrong';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rota_import_batches WHERE id = pg_temp.fx('b16'))
     OR EXISTS (SELECT 1 FROM public.rota_match_previews WHERE org_id = pg_temp.fx('org_a') AND upload_id = pg_temp.fx('b18'))
     OR NOT EXISTS (SELECT 1 FROM public.rota_match_previews WHERE org_id = pg_temp.fx('org_a') AND upload_id = pg_temp.fx('b19')) THEN
    RAISE EXCEPTION 'FAIL L8: audit purge wrong';
  END IF;
  -- Purging one org never touches another.
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE org_id = pg_temp.fx('org_b')) THEN
    RAISE EXCEPTION 'FAIL L8: org-scoped purge touched org B';
  END IF;
  -- Global purge runs too.
  v := public.purge_rota_data_v1(NULL);
END $$;

-- ---------------------------------------------------------------------------
-- L10: primary-selection parity P1–P9 through record_attendance_evidence_v2.
-- Session 12:30–13:30 two days ago; t1 < t2 < t3 after the end. RECALL rows
-- are normally produced only by complete_recall_catchup_v2; the producer guard
-- is disabled inside this rolled-back transaction to build the cases.
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_evidence DISABLE TRIGGER attendance_recall_evidence_producer;

CREATE FUNCTION pg_temp.parity_case(p_label text, p_steps jsonb, p_status text, p_primary text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_session uuid;
  v_start timestamptz := date_trunc('day', now()) - interval '2 days' + interval '12 hours 30 minutes';
  v_end timestamptz := date_trunc('day', now()) - interval '2 days' + interval '13 hours 30 minutes';
  step jsonb;
  v_at timestamptz;
  v_src text;
  a public.attendance%ROWTYPE;
  i integer := 0;
BEGIN
  INSERT INTO public.sessions (org_id, department_id, title, date_start, date_end, location_type, status, created_by)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Parity ' || p_label, v_start, v_end, 'IN_PERSON', 'PUBLISHED', pg_temp.fx('u_mod_a'))
  RETURNING id INTO v_session;

  FOR step IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
    i := i + 1;
    v_src := step->>'source';
    v_at := CASE step->>'at'
      WHEN '12:25' THEN v_start - interval '5 minutes'
      WHEN 't1' THEN v_end + interval '1 hour'
      WHEN 't2' THEN v_end + interval '2 hours'
      WHEN 't3' THEN v_end + interval '3 hours'
    END;
    a := public.record_attendance_evidence_v2(
      pg_temp.fx('org_a'), v_session, pg_temp.fx('dept_a1'), pg_temp.fx('u_t1'), NULL,
      v_src::evidence_source_type, v_at,
      CASE v_src
        WHEN 'MODERATOR_CONFIRMATION' THEN jsonb_build_object('status_override', step->>'override')
        WHEN 'RECALL' THEN jsonb_build_object('status_override', 'PRESENT', 'method', 'AUDIO_RECAP_CATCH_UP')
        ELSE '{}'::jsonb
      END,
      pg_temp.fx('u_mod_a'), 'parity-' || p_label || '-' || i,
      CASE WHEN v_src = 'MODERATOR_CONFIRMATION' THEN 'Parity case' ELSE NULL END);
  END LOOP;

  IF i = 0 THEN
    IF EXISTS (SELECT 1 FROM public.attendance WHERE session_id = v_session) THEN
      RAISE EXCEPTION 'FAIL L10 %: attendance without evidence', p_label;
    END IF;
    RETURN;
  END IF;
  IF a.status <> p_status OR a.primary_source::text IS DISTINCT FROM p_primary THEN
    RAISE EXCEPTION 'FAIL L10 %: expected %/% got %/%', p_label, p_status, p_primary, a.status, a.primary_source;
  END IF;
END $$;

DO $$
BEGIN
  PERFORM pg_temp.parity_case('P1', '[]', 'ABSENT', NULL);
  PERFORM pg_temp.parity_case('P2', '[{"source":"SELF_CHECKIN","at":"12:25"}]', 'PRESENT', 'SELF_CHECKIN');
  PERFORM pg_temp.parity_case('P3', '[{"source":"SELF_CHECKIN","at":"12:25"},{"source":"MODERATOR_CONFIRMATION","at":"t1","override":"EXCUSED"}]', 'EXCUSED', 'MODERATOR_CONFIRMATION');
  PERFORM pg_temp.parity_case('P4', '[{"source":"MODERATOR_CONFIRMATION","at":"t1","override":"EXCUSED"},{"source":"MODERATOR_CONFIRMATION","at":"t2","override":"PRESENT"}]', 'PRESENT', 'MODERATOR_CONFIRMATION');
  PERFORM pg_temp.parity_case('P5', '[{"source":"MODERATOR_CONFIRMATION","at":"t1","override":"EXCUSED"},{"source":"RECALL","at":"t2"}]', 'PRESENT', 'RECALL');
  PERFORM pg_temp.parity_case('P6', '[{"source":"MODERATOR_CONFIRMATION","at":"t1","override":"EXCUSED"},{"source":"RECALL","at":"t2"},{"source":"MODERATOR_CONFIRMATION","at":"t3","override":"EXCUSED"}]', 'EXCUSED', 'MODERATOR_CONFIRMATION');
  PERFORM pg_temp.parity_case('P7', '[{"source":"MODERATOR_CONFIRMATION","at":"t1","override":"ABSENT"},{"source":"RECALL","at":"t2"}]', 'PRESENT', 'RECALL');
  PERFORM pg_temp.parity_case('P8', '[{"source":"MODERATOR_CONFIRMATION","at":"t1","override":"EXCUSED"},{"source":"RECALL","at":"t2"},{"source":"TEAMS","at":"t3"}]', 'PRESENT', 'RECALL');
  PERFORM pg_temp.parity_case('P9', '[{"source":"RECALL","at":"t1"},{"source":"MODERATOR_CONFIRMATION","at":"t2","override":"EXCUSED"}]', 'EXCUSED', 'MODERATOR_CONFIRMATION');
  -- Recording order must not matter: P4 recorded newest-first still picks the latest.
  PERFORM pg_temp.parity_case('P4-reversed', '[{"source":"MODERATOR_CONFIRMATION","at":"t2","override":"PRESENT"},{"source":"MODERATOR_CONFIRMATION","at":"t1","override":"EXCUSED"}]', 'PRESENT', 'MODERATOR_CONFIRMATION');
END $$;

ALTER TABLE public.attendance_evidence ENABLE TRIGGER attendance_recall_evidence_producer;

-- ---------------------------------------------------------------------------
-- L11 + L12: Recall catch-up for a finalized EXCUSED (rota) attendee.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_session uuid := pg_temp.fx('s_recall');
  v_digest text := encode(sha256(convert_to('lab recap script', 'UTF8')), 'hex');
  v_set uuid;
  v_play public.recall_playback_progress%ROWTYPE;
  v_attempt uuid;
  v_completion public.recall_completions%ROWTYPE;
  a public.attendance%ROWTYPE;
  v jsonb;
  u text;
BEGIN
  IF public.recall_catchup_eligible_statuses_v1() <> ARRAY['ABSENT', 'EXCUSED']::text[] THEN
    RAISE EXCEPTION 'FAIL L12: marker returned %', public.recall_catchup_eligible_statuses_v1();
  END IF;

  -- T1: rota flag → confirm (EXCUSED). T2: no evidence (ABSENT path).
  -- T3: participant expectation EXCUSED. T4 (u_teacher): accepted teacher.
  v := pg_temp.ingest('org_a', 'dept_a1', pg_temp.fx('b17'), 'WORKED', 'b17',
         jsonb_build_array(pg_temp.pair('s_recall', 'u_t1'), pg_temp.pair('s_recall', 'u_t3'), pg_temp.pair('s_recall', 'u_teacher')), '[]');
  PERFORM public.confirm_rota_excusal_v1(pg_temp.fx('org_a'), v_session, pg_temp.fx('u_t1'), pg_temp.fx('u_mod_a'));
  PERFORM public.confirm_rota_excusal_v1(pg_temp.fx('org_a'), v_session, pg_temp.fx('u_t3'), pg_temp.fx('u_mod_a'));
  PERFORM public.confirm_rota_excusal_v1(pg_temp.fx('org_a'), v_session, pg_temp.fx('u_teacher'), pg_temp.fx('u_mod_a'));
  -- One transaction = one now(): place the confirmations an hour before the
  -- catch-up, as they would be in real time.
  UPDATE public.attendance_evidence SET observed_at = observed_at - interval '1 hour'
  WHERE session_id = v_session AND source = 'MODERATOR_CONFIRMATION';
  UPDATE public.session_participants SET expectation = 'EXCUSED' WHERE session_id = v_session AND user_id = pg_temp.fx('u_t3');
  INSERT INTO public.session_teachers (org_id, session_id, user_id, status) VALUES (pg_temp.fx('org_a'), v_session, pg_temp.fx('u_teacher'), 'ACCEPTED');

  PERFORM public.finalize_session_attendance_v2(pg_temp.fx('org_a'), v_session, pg_temp.fx('u_mod_a'));
  SELECT * INTO a FROM public.attendance WHERE session_id = v_session AND user_id = pg_temp.fx('u_t1');
  IF a.status <> 'EXCUSED' OR a.finalized_at IS NULL THEN RAISE EXCEPTION 'FAIL L11: T1 not finalized EXCUSED'; END IF;
  IF (SELECT expectation FROM public.session_participants WHERE session_id = v_session AND user_id = pg_temp.fx('u_t1')) <> 'EXPECTED' THEN
    RAISE EXCEPTION 'FAIL L11: T1 expectation not normalised to EXPECTED';
  END IF;
  IF (SELECT status FROM public.attendance WHERE session_id = v_session AND user_id = pg_temp.fx('u_t2')) <> 'ABSENT' THEN
    RAISE EXCEPTION 'FAIL L11: T2 not ABSENT';
  END IF;

  INSERT INTO public.audio_recaps (org_id, session_id, script, status, script_digest, audio_revision, audio_duration_seconds)
  VALUES (pg_temp.fx('org_a'), v_session, 'lab recap script', 'approved', v_digest, 1, 1);
  INSERT INTO public.recall_question_sets (org_id, session_id, questions, status, revision, script_digest, published_at, catchup_opens_at, catchup_closes_at)
  VALUES (pg_temp.fx('org_a'), v_session, '[{},{},{},{},{}]'::jsonb, 'approved', 1, v_digest, now(), now() - interval '1 hour', now() + interval '7 days')
  RETURNING id INTO v_set;

  FOREACH u IN ARRAY ARRAY['u_t1', 'u_t2', 'u_t3', 'u_teacher'] LOOP
    v_play := public.record_recall_playback_v1(v_set, pg_temp.fx(u), 1, true, true);
    IF v_play.completed_at IS NULL THEN RAISE EXCEPTION 'FAIL L11 setup: playback not complete for %', u; END IF;
    INSERT INTO public.recall_attempts (org_id, session_id, question_set_id, playback_id, user_id, attempt_number, answers, score, passed)
    VALUES (pg_temp.fx('org_a'), v_session, v_set, v_play.id, pg_temp.fx(u), 1, '[0,0,0,0,0]'::jsonb, 5, true)
    RETURNING id INTO v_attempt;
    INSERT INTO rota_fx VALUES ('attempt_' || u, v_attempt);
  END LOOP;

  -- EXCUSED (rota) completes.
  v_completion := public.complete_recall_catchup_v2(v_set, pg_temp.fx('u_t1'), pg_temp.fx('attempt_u_t1'));
  SELECT * INTO a FROM public.attendance WHERE session_id = v_session AND user_id = pg_temp.fx('u_t1');
  IF a.status <> 'PRESENT' OR a.primary_source <> 'RECALL' THEN
    RAISE EXCEPTION 'FAIL L11: EXCUSED catch-up gave %/%', a.status, a.primary_source;
  END IF;
  -- ABSENT path unchanged.
  PERFORM public.complete_recall_catchup_v2(v_set, pg_temp.fx('u_t2'), pg_temp.fx('attempt_u_t2'));
  IF (SELECT status FROM public.attendance WHERE session_id = v_session AND user_id = pg_temp.fx('u_t2')) <> 'PRESENT' THEN
    RAISE EXCEPTION 'FAIL L11: ABSENT path changed';
  END IF;
  -- Participant expectation EXCUSED and accepted teacher are refused.
  BEGIN
    PERFORM public.complete_recall_catchup_v2(v_set, pg_temp.fx('u_t3'), pg_temp.fx('attempt_u_t3'));
    RAISE EXCEPTION 'FAIL L11: expectation EXCUSED participant completed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.complete_recall_catchup_v2(v_set, pg_temp.fx('u_teacher'), pg_temp.fx('attempt_u_teacher'));
    RAISE EXCEPTION 'FAIL L11: accepted teacher completed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;

  -- The catch-up certificate passes the eligibility trigger.
  INSERT INTO public.certificates (org_id, department_id, session_id, user_id, certificate_role, certificate_code, recognition_basis)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), v_session, pg_temp.fx('u_t1'), 'ATTENDEE', 'LAB-ROTA-' || substr(gen_random_uuid()::text, 1, 8), 'AUDIO_RECAP_CATCH_UP');

  -- Reopen + new TEAMS evidence keeps the catch-up PRESENT (D8 / O2).
  PERFORM public.reopen_session_attendance_v2(pg_temp.fx('org_a'), v_session, pg_temp.fx('u_mod_a'), 'Lab review');
  a := public.record_attendance_evidence_v2(
    pg_temp.fx('org_a'), v_session, pg_temp.fx('dept_a1'), pg_temp.fx('u_t1'), NULL,
    'TEAMS', now() + interval '30 seconds', '{}'::jsonb, pg_temp.fx('u_mod_a'), 'lab-teams-t1', NULL);
  IF a.status <> 'PRESENT' OR a.primary_source <> 'RECALL' THEN
    RAISE EXCEPTION 'FAIL L11: reopen + TEAMS reverted the catch-up to %/%', a.status, a.primary_source;
  END IF;
  -- A later moderator re-excusal wins.
  a := public.record_attendance_evidence_v2(
    pg_temp.fx('org_a'), v_session, pg_temp.fx('dept_a1'), pg_temp.fx('u_t1'), NULL,
    'MODERATOR_CONFIRMATION', now() + interval '1 minute', '{"status_override":"EXCUSED"}'::jsonb,
    pg_temp.fx('u_mod_a'), 'lab-reexcuse-t1', 'Lab re-excusal');
  IF a.status <> 'EXCUSED' OR a.primary_source <> 'MODERATOR_CONFIRMATION' THEN
    RAISE EXCEPTION 'FAIL L11: later moderator decision did not win: %/%', a.status, a.primary_source;
  END IF;
  PERFORM public.finalize_session_attendance_v2(pg_temp.fx('org_a'), v_session, pg_temp.fx('u_mod_a'));
  IF (SELECT status FROM public.attendance WHERE session_id = v_session AND user_id = pg_temp.fx('u_t1')) <> 'EXCUSED' THEN
    RAISE EXCEPTION 'FAIL L11: refinalize changed the status';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- L9: disable keeps configuration and audit, deletes flags and links.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
  n_profiles integer;
  n_batches integer;
  n_uploaders integer;
  n_depts integer;
  n_previews integer;
BEGIN
  INSERT INTO public.rota_upload_profiles (org_id, department_id, name, config)
  VALUES (pg_temp.fx('org_a'), pg_temp.fx('dept_a1'), 'Lab profile', '{"v":1}'::jsonb);
  SELECT count(*) INTO n_profiles FROM public.rota_upload_profiles WHERE org_id = pg_temp.fx('org_a');
  SELECT count(*) INTO n_batches FROM public.rota_import_batches WHERE org_id = pg_temp.fx('org_a');
  SELECT count(*) INTO n_uploaders FROM public.rota_uploaders WHERE org_id = pg_temp.fx('org_a');
  SELECT count(*) INTO n_depts FROM public.rota_departments WHERE org_id = pg_temp.fx('org_a');
  SELECT count(*) INTO n_previews FROM public.rota_match_previews WHERE org_id = pg_temp.fx('org_a');
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE org_id = pg_temp.fx('org_a'))
     OR NOT EXISTS (SELECT 1 FROM public.rota_identity_links WHERE org_id = pg_temp.fx('org_a')) THEN
    RAISE EXCEPTION 'FAIL L9 setup: nothing to delete';
  END IF;

  v := public.disable_rota_for_org_v1(pg_temp.fx('org_a'), pg_temp.fx('u_admin_a'));
  IF (v->>'flags')::int < 1 OR (v->>'links')::int < 1 THEN RAISE EXCEPTION 'FAIL L9: counts %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.rota_session_flags WHERE org_id = pg_temp.fx('org_a'))
     OR EXISTS (SELECT 1 FROM public.rota_identity_links WHERE org_id = pg_temp.fx('org_a'))
     OR (SELECT enabled FROM public.rota_settings WHERE org_id = pg_temp.fx('org_a')) THEN
    RAISE EXCEPTION 'FAIL L9: data left after disable';
  END IF;
  IF n_profiles <> (SELECT count(*) FROM public.rota_upload_profiles WHERE org_id = pg_temp.fx('org_a'))
     OR n_batches <> (SELECT count(*) FROM public.rota_import_batches WHERE org_id = pg_temp.fx('org_a'))
     OR n_uploaders <> (SELECT count(*) FROM public.rota_uploaders WHERE org_id = pg_temp.fx('org_a'))
     OR n_depts <> (SELECT count(*) FROM public.rota_departments WHERE org_id = pg_temp.fx('org_a'))
     OR n_previews <> (SELECT count(*) FROM public.rota_match_previews WHERE org_id = pg_temp.fx('org_a')) THEN
    RAISE EXCEPTION 'FAIL L9: disable removed configuration or audit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rota_session_flags WHERE org_id = pg_temp.fx('org_b')) THEN
    RAISE EXCEPTION 'FAIL L9: disable touched org B';
  END IF;
  -- Ingest now refuses.
  PERFORM pg_temp.expect_rota(
    format('SELECT pg_temp.ingest(%L, %L, %L::uuid, %L, %L, %L::jsonb, %L::jsonb)',
           'org_a', 'dept_a1', gen_random_uuid(), 'PLANNED', 'after-disable', '[]', '[]'),
    'disabled', 'L9 ingest after disable');
END $$;

-- ---------------------------------------------------------------------------
-- No table holds codes, names, emails or identifiers in clear.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name LIKE 'rota\_%'
      AND column_name ~ '(name|email|code|category|staff|grid|status)'
      AND NOT (table_name = 'rota_upload_profiles' AND column_name = 'name')
  ) THEN
    RAISE EXCEPTION 'FAIL L0: a rota table has an identifying or category column';
  END IF;
END $$;

SELECT 'rota lab checks: PASS' AS result;

ROLLBACK;
