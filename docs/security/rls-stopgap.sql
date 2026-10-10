-- Petrios stopgap: remove ANONYMOUS (public anon key) access to the worst-exposed
-- data and server-only functions. Signed-in users are unaffected by everything
-- except the feedback write revoke (no app path writes feedback with the user's
-- session; submissions use the server key). Safe to re-run.
BEGIN;
REVOKE ALL ON public.session_feedback FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.session_feedback FROM authenticated;
REVOKE ALL ON public.teacher_invitations FROM anon;
REVOKE ALL ON public.certificates FROM anon;
DO $stopgap$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
      'record_attendance_evidence_v2', 'finalize_session_attendance_v2',
      'reopen_session_attendance_v2', 'rotate_session_group_code_v2',
      'replace_recall_question_set_draft_v1', 'recall_published_question_set_v1',
      'publish_recall_question_set_v1', 'record_recall_playback_v1',
      'complete_recall_catchup_v2', 'claim_ops_newsletter_delivery_v1',
      'generate_group_code'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$stopgap$;
NOTIFY pgrst, 'reload schema';
COMMIT;
