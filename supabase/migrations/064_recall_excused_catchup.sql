-- 064: Recall catch-up for finalized EXCUSED attendees + latest moderator
-- decision wins (spec/03, spec/08).
--
-- Requires 045, 059 and 062. Apply it in the same release as 063 (either
-- order): the application keeps rota availability "not installed" until the
-- marker below exists and includes EXCUSED, and confirm_rota_excusal_v1 (063)
-- checks the same marker, so a rota excusal can never remove a trainee's
-- catch-up route (owner decision O2). The application also keeps its
-- policy-v1 recomputation (lib/attendance/compute.ts) on the pre-064
-- earliest-first rule until this marker exists, so the TypeScript and SQL
-- primary-evidence rules always agree.
--
-- Owner decision O2: a finalized EXCUSED expected attendee who completes the
-- governed Audio Recap catch-up (exact approved audio + 5/5) becomes the same
-- transparent catch-up PRESENT as a finalized ABSENT attendee. This applies to
-- every EXCUSED, not only rota excusals: the rule is keyed on attendance
-- status and evidence order, never on a reason code.
--
-- P0.3: among moderator confirmations, the LATEST (observed_at, then
-- created_at, then id) is primary, so a moderator can correct their own
-- earlier decision. Previously the earliest of equal priority won.
--
-- D8: a governed RECALL row observed after the latest moderator decision
-- outranks it when that decision overrides to ABSENT or EXCUSED, so a reopen
-- followed by any new evidence no longer reverts a catch-up PRESENT. A
-- moderator decision recorded after the catch-up still wins.
--
-- 1. record_attendance_evidence_v2: the 045 body unchanged except the
--    primary-row selection. Same signature.
-- 2. complete_recall_catchup_v2: the 059 body unchanged except that the
--    current finalized attendance may be ABSENT or EXCUSED. Same signature;
--    the ATTENDEE/EXPECTED participant check and the accepted-teacher
--    exclusion stay.
-- 3. recall_catchup_eligible_statuses_v1(): marker the app reads (plan D7);
--    before 064 the function is missing and the app keeps ['ABSENT'].
-- 4. Re-opens the catch-up send marker of approved sets whose window is still
--    open, so EXCUSED expected attendees of packages sent before 064 are
--    invited too. The per-recipient delivery ledger skips everyone already
--    sent.
-- finalize/reopen do not recompute and are unchanged; is_evidence_valid and
-- the certificate eligibility trigger already accept PRESENT + RECALL.

-- 1. Evidence writer: latest moderator decision wins; RECALL after an
--    ABSENT/EXCUSED override wins.
CREATE OR REPLACE FUNCTION public.record_attendance_evidence_v2(
  p_org_id UUID,
  p_session_id UUID,
  p_department_id UUID,
  p_user_id UUID,
  p_external_email TEXT,
  p_source evidence_source_type,
  p_observed_at TIMESTAMPTZ,
  p_metadata JSONB,
  p_created_by UUID,
  p_source_event_key TEXT DEFAULT NULL,
  p_correction_reason TEXT DEFAULT NULL
) RETURNS public.attendance AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_existing public.attendance_evidence%ROWTYPE;
  v_primary public.attendance_evidence%ROWTYPE;
  v_latest_mc public.attendance_evidence%ROWTYPE;
  v_recall public.attendance_evidence%ROWTYPE;
  v_status TEXT;
  v_result public.attendance%ROWTYPE;
BEGIN
  IF (p_user_id IS NULL) = (p_external_email IS NULL) THEN
    RAISE EXCEPTION 'Exactly one attendance subject is required';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id AND org_id = p_org_id AND department_id = p_department_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.attendance_phase = 'FINALIZED' OR v_session.attendance_locked THEN
    RAISE EXCEPTION 'Attendance is finalized';
  END IF;
  IF NOT is_evidence_valid(p_session_id, p_source, p_observed_at) THEN
    RAISE EXCEPTION 'Evidence is outside its valid window';
  END IF;
  IF p_source = 'MODERATOR_CONFIRMATION'
     AND (p_correction_reason IS NULL OR length(trim(p_correction_reason)) < 3) THEN
    RAISE EXCEPTION 'Moderator confirmation requires a reason';
  END IF;

  IF p_source_event_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.attendance_evidence
    WHERE session_id = p_session_id AND source_event_key = p_source_event_key;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.attendance_evidence (
      org_id, session_id, department_id, user_id, external_email, source,
      observed_at, metadata, created_by, source_event_key, correction_reason
    ) VALUES (
      p_org_id, p_session_id, p_department_id, p_user_id,
      CASE WHEN p_external_email IS NULL THEN NULL ELSE lower(trim(p_external_email)) END,
      p_source, p_observed_at, COALESCE(p_metadata, '{}'::jsonb), p_created_by,
      p_source_event_key, NULLIF(trim(p_correction_reason), '')
    );
  END IF;

  INSERT INTO public.session_participants (
    org_id, department_id, session_id, user_id, external_email, added_by,
    participant_role, expectation
  ) VALUES (
    p_org_id, p_department_id, p_session_id, p_user_id,
    CASE WHEN p_external_email IS NULL THEN NULL ELSE lower(trim(p_external_email)) END,
    p_created_by, 'ATTENDEE', 'OPTIONAL'
  )
  ON CONFLICT DO NOTHING;

  -- 064: the latest moderator decision wins (P0.3). A later governed RECALL
  -- catch-up outranks an ABSENT or EXCUSED moderator decision (O2, D8); a
  -- moderator decision made after the catch-up still wins. Keyed on status and
  -- order only, never on a reason code. Mirrored by lib/attendance/compute.ts.
  SELECT ev.* INTO v_latest_mc
  FROM public.attendance_evidence ev
  WHERE ev.session_id = p_session_id
    AND (
      (p_user_id IS NOT NULL AND ev.user_id = p_user_id)
      OR (p_external_email IS NOT NULL AND lower(ev.external_email) = lower(trim(p_external_email)))
    )
    AND is_evidence_valid(p_session_id, ev.source, ev.observed_at)
    AND NOT (
      v_session.attendance_policy_version = 2
      AND ev.source = 'TEACHER'
      AND COALESCE((ev.metadata->>'assigned_as_teacher')::BOOLEAN, false)
    )
    AND ev.source = 'MODERATOR_CONFIRMATION'
  ORDER BY ev.observed_at DESC, ev.created_at DESC, ev.id DESC
  LIMIT 1;

  IF v_latest_mc.id IS NOT NULL THEN
    v_primary := v_latest_mc;
    IF v_latest_mc.metadata->>'status_override' IN ('ABSENT', 'EXCUSED') THEN
      SELECT ev.* INTO v_recall
      FROM public.attendance_evidence ev
      WHERE ev.session_id = p_session_id
        AND (
          (p_user_id IS NOT NULL AND ev.user_id = p_user_id)
          OR (p_external_email IS NOT NULL AND lower(ev.external_email) = lower(trim(p_external_email)))
        )
        AND is_evidence_valid(p_session_id, ev.source, ev.observed_at)
        AND NOT (
          v_session.attendance_policy_version = 2
          AND ev.source = 'TEACHER'
          AND COALESCE((ev.metadata->>'assigned_as_teacher')::BOOLEAN, false)
        )
        AND ev.source = 'RECALL'
        AND ev.observed_at > v_latest_mc.observed_at
      ORDER BY ev.observed_at ASC, ev.created_at ASC, ev.id ASC
      LIMIT 1;
      IF v_recall.id IS NOT NULL THEN
        v_primary := v_recall;
      END IF;
    END IF;
  ELSE
    SELECT ev.* INTO v_primary
    FROM public.attendance_evidence ev
    WHERE ev.session_id = p_session_id
      AND (
        (p_user_id IS NOT NULL AND ev.user_id = p_user_id)
        OR (p_external_email IS NOT NULL AND lower(ev.external_email) = lower(trim(p_external_email)))
      )
      AND is_evidence_valid(p_session_id, ev.source, ev.observed_at)
      AND NOT (
        v_session.attendance_policy_version = 2
        AND ev.source = 'TEACHER'
        AND COALESCE((ev.metadata->>'assigned_as_teacher')::BOOLEAN, false)
      )
    ORDER BY
      CASE ev.source
        WHEN 'MODERATOR_CONFIRMATION' THEN 6
        WHEN 'TEACHER' THEN 5
        WHEN 'TEAMS' THEN 4
        WHEN 'FEEDBACK' THEN 3
        WHEN 'GROUP_CODE' THEN 2
        WHEN 'SELF_CHECKIN' THEN 1
        WHEN 'RECALL' THEN 0
      END DESC,
      ev.observed_at ASC
    LIMIT 1;
  END IF;

  IF v_primary.id IS NULL THEN
    v_status := 'ABSENT';
  ELSIF v_primary.metadata ? 'status_override' THEN
    v_status := v_primary.metadata->>'status_override';
  ELSIF v_primary.observed_at > v_session.date_start
      + (COALESCE(v_session.late_after_mins, 10) || ' minutes')::INTERVAL THEN
    v_status := 'LATE';
  ELSE
    v_status := 'PRESENT';
  END IF;

  IF p_user_id IS NOT NULL THEN
    INSERT INTO public.attendance (
      org_id, session_id, department_id, user_id, external_email, status,
      primary_source, first_evidence_at, computed_at, locked, revision
    ) VALUES (
      p_org_id, p_session_id, p_department_id, p_user_id, NULL,
      v_status, v_primary.source, v_primary.observed_at, now(), false,
      v_session.attendance_revision
    )
    ON CONFLICT (session_id, user_id) WHERE user_id IS NOT NULL
    DO UPDATE SET
      status = EXCLUDED.status,
      primary_source = EXCLUDED.primary_source,
      first_evidence_at = EXCLUDED.first_evidence_at,
      computed_at = now(),
      locked = false,
      revision = EXCLUDED.revision
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.attendance (
      org_id, session_id, department_id, user_id, external_email, status,
      primary_source, first_evidence_at, computed_at, locked, revision
    ) VALUES (
      p_org_id, p_session_id, p_department_id, NULL, lower(trim(p_external_email)),
      v_status, v_primary.source, v_primary.observed_at, now(), false,
      v_session.attendance_revision
    )
    ON CONFLICT (session_id, external_email) WHERE external_email IS NOT NULL
    DO UPDATE SET
      status = EXCLUDED.status,
      primary_source = EXCLUDED.primary_source,
      first_evidence_at = EXCLUDED.first_evidence_at,
      computed_at = now(),
      locked = false,
      revision = EXCLUDED.revision
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id,
    subject_user_id, subject_external_email, details
  ) VALUES (
    p_org_id, p_department_id, p_session_id, 'ATTENDANCE_EVIDENCE_RECORDED',
    p_created_by, p_user_id,
    CASE WHEN p_external_email IS NULL THEN NULL ELSE lower(trim(p_external_email)) END,
    jsonb_build_object('source', p_source, 'source_event_key', p_source_event_key)
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.record_attendance_evidence_v2(
  UUID, UUID, UUID, UUID, TEXT, evidence_source_type, TIMESTAMPTZ,
  JSONB, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_attendance_evidence_v2(
  UUID, UUID, UUID, UUID, TEXT, evidence_source_type, TIMESTAMPTZ,
  JSONB, UUID, TEXT, TEXT
) TO service_role;

-- 2. Catch-up completion: ABSENT or EXCUSED.
CREATE OR REPLACE FUNCTION public.complete_recall_catchup_v2(
  p_question_set_id UUID,
  p_user_id UUID,
  p_perfect_attempt_id UUID
) RETURNS public.recall_completions AS $$
DECLARE
  v_set public.recall_question_sets%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_recap public.audio_recaps%ROWTYPE;
  v_playback public.recall_playback_progress%ROWTYPE;
  v_attempt public.recall_attempts%ROWTYPE;
  v_attendance public.attendance%ROWTYPE;
  v_completion public.recall_completions%ROWTYPE;
BEGIN
  SELECT * INTO v_set FROM public.recall_question_sets
  WHERE id = p_question_set_id AND status = 'approved';
  IF NOT FOUND OR v_set.script_digest IS NULL
     OR jsonb_array_length(v_set.questions) <> 5 THEN
    RAISE EXCEPTION 'Five published catch-up questions are required';
  END IF;

  SELECT * INTO v_session FROM public.sessions
  WHERE id = v_set.session_id FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'PUBLISHED'
     OR v_session.attendance_policy_version < 2
     OR v_session.attendance_phase <> 'FINALIZED' THEN
    RAISE EXCEPTION 'Finalized policy-v2 attendance is required';
  END IF;
  IF v_set.catchup_opens_at IS NULL OR v_set.catchup_closes_at IS NULL
     OR now() < v_set.catchup_opens_at OR now() > v_set.catchup_closes_at THEN
    RAISE EXCEPTION 'The catch-up window is closed';
  END IF;

  SELECT * INTO v_recap FROM public.audio_recaps
  WHERE session_id = v_session.id AND status = 'approved'
    AND script_digest = v_set.script_digest AND audio_revision > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'The approved audio recap is not current'; END IF;

  SELECT * INTO v_playback FROM public.recall_playback_progress
  WHERE question_set_id = v_set.id AND user_id = p_user_id
    AND audio_revision = v_recap.audio_revision AND completed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified audio playback is required'; END IF;

  SELECT * INTO v_attempt FROM public.recall_attempts
  WHERE id = p_perfect_attempt_id AND question_set_id = v_set.id
    AND user_id = p_user_id AND passed = true AND score = 5 AND total = 5;
  IF NOT FOUND THEN RAISE EXCEPTION 'A perfect five-question attempt is required'; END IF;

  SELECT * INTO v_completion FROM public.recall_completions
  WHERE session_id = v_session.id AND user_id = p_user_id;
  IF FOUND THEN RETURN v_completion; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = v_session.id AND sp.user_id = p_user_id
      AND sp.participant_role = 'ATTENDEE' AND sp.expectation = 'EXPECTED'
  ) OR EXISTS (
    SELECT 1 FROM public.session_teachers st
    WHERE st.session_id = v_session.id AND st.user_id = p_user_id
      AND st.status = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'The user is not an eligible registered absentee';
  END IF;

  SELECT * INTO v_attendance FROM public.attendance
  WHERE session_id = v_session.id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_attendance.status NOT IN ('ABSENT', 'EXCUSED')
     OR v_attendance.revision <> v_session.attendance_revision THEN
    RAISE EXCEPTION 'Only a current finalized absence or excusal can use catch-up recognition';
  END IF;

  INSERT INTO public.recall_completions (
    org_id, department_id, session_id, question_set_id, playback_id,
    perfect_attempt_id, user_id, attendance_revision
  ) VALUES (
    v_session.org_id, v_session.department_id, v_session.id, v_set.id,
    v_playback.id, v_attempt.id, p_user_id, v_session.attendance_revision
  ) RETURNING * INTO v_completion;

  INSERT INTO public.attendance_evidence (
    org_id, session_id, department_id, user_id, source, observed_at,
    metadata, created_by, source_event_key
  ) VALUES (
    v_session.org_id, v_session.id, v_session.department_id, p_user_id,
    'RECALL', now(),
    jsonb_build_object(
      'status_override', 'PRESENT',
      'method', 'AUDIO_RECAP_CATCH_UP',
      'recall_completion_id', v_completion.id,
      'question_set_id', v_set.id,
      'audio_revision', v_recap.audio_revision
    ),
    p_user_id,
    'RECALL_CATCH_UP:' || v_set.id::TEXT || ':' || p_user_id::TEXT
  ) ON CONFLICT (session_id, source_event_key) WHERE source_event_key IS NOT NULL
    DO NOTHING;

  UPDATE public.attendance
  SET status = 'PRESENT', primary_source = 'RECALL', first_evidence_at = now(),
      computed_at = now(), locked = true, locked_by = p_user_id,
      locked_at = now(), finalized_at = now(), finalized_by = p_user_id
  WHERE id = v_attendance.id;

  INSERT INTO public.session_activity_events (
    org_id, department_id, session_id, event_type, actor_user_id,
    subject_user_id, details
  ) VALUES (
    v_session.org_id, v_session.department_id, v_session.id,
    'RECALL_CATCH_UP_RECOGNIZED', p_user_id, p_user_id,
    jsonb_build_object(
      'completion_id', v_completion.id,
      'question_set_id', v_set.id,
      'attendance_revision', v_session.attendance_revision,
      'source', 'RECALL'
    )
  );

  RETURN v_completion;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.complete_recall_catchup_v2(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_recall_catchup_v2(UUID, UUID, UUID) TO service_role;

-- 3. Eligible-status marker (plan D7).
CREATE OR REPLACE FUNCTION public.recall_catchup_eligible_statuses_v1()
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['ABSENT', 'EXCUSED']::text[]
$$;

REVOKE ALL ON FUNCTION public.recall_catchup_eligible_statuses_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recall_catchup_eligible_statuses_v1() TO service_role;

-- 4. Packages already sent before 064: the recall-send cron re-runs them for
--    the newly eligible EXCUSED attendees. RECALL_CATCHUP_INVITE delivery rows
--    (per recipient, related to the set) make this idempotent for everyone
--    already invited, and closed windows are left alone.
UPDATE public.recall_question_sets
SET sent_catchup_at = NULL
WHERE status = 'approved'
  AND sent_catchup_at IS NOT NULL
  AND catchup_closes_at IS NOT NULL
  AND catchup_closes_at > now();

COMMENT ON FUNCTION public.record_attendance_evidence_v2(
  UUID, UUID, UUID, UUID, TEXT, evidence_source_type, TIMESTAMPTZ,
  JSONB, UUID, TEXT, TEXT
) IS 'Policy-v2 evidence writer + recompute. 064: the latest MODERATOR_CONFIRMATION is primary; a later RECALL outranks an ABSENT/EXCUSED override (status-keyed, never reason-keyed). Mirrored by lib/attendance/compute.ts.';
COMMENT ON FUNCTION public.complete_recall_catchup_v2(UUID, UUID, UUID) IS
  'Sole RECALL producer. 064: a current finalized ABSENT or EXCUSED expected attendee (never an accepted teacher) may complete catch-up recognition.';
COMMENT ON FUNCTION public.recall_catchup_eligible_statuses_v1() IS
  'Finalized attendance statuses eligible for Recall catch-up (read by the app; absent before 064 means ABSENT only).';
