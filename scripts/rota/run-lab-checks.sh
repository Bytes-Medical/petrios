#!/usr/bin/env bash
# Rota availability lab checks (plan §5.2). LAB DATABASE ONLY.
#
# 1. Refuses any target other than the local lab (127.0.0.1:55322).
# 2. Applies migrations 063 and 064 when they are not already present
#    (psql -1, ON_ERROR_STOP), exactly as scripts/migrate.mjs would wrap them.
# 3. Runs scripts/rota/lab-checks.sql (one transaction, rolled back).
# 4. Runs the two concurrency checks as parallel psql processes against a
#    committed synthetic fixture, which is deleted again on exit:
#      L6  two ingests for one org serialise on the advisory lock;
#      L7c two concurrent confirms write exactly one moderator row.
#
# Usage: scripts/rota/run-lab-checks.sh
#   ROTA_LAB_DB_URL overrides the URL, but must still point at 127.0.0.1:55322.
# Never point this at production or any remote Supabase.
set -euo pipefail

DB_URL="${ROTA_LAB_DB_URL:-postgresql://postgres:postgres@127.0.0.1:55322/postgres}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:55322/*|postgres://*@127.0.0.1:55322/*) ;;
  *)
    echo "run-lab-checks: refusing: the target must be the local lab at 127.0.0.1:55322" >&2
    exit 2
    ;;
esac
# psql must not pick up a different server from the environment.
unset PGHOST PGPORT PGSERVICE PGSERVICEFILE PGHOSTADDR || true

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG063="$ROOT/supabase/migrations/063_rota_availability.sql"
MIG064="$ROOT/supabase/migrations/064_recall_excused_catchup.sql"
CHECKS="$ROOT/scripts/rota/lab-checks.sql"

psql_q() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
psql_val() { psql "$DB_URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# --- 2. migrations ----------------------------------------------------------
if [ "$(psql_val "select to_regclass('public.rota_settings') is not null")" != "t" ]; then
  echo "applying 063_rota_availability.sql"
  psql_q -1 -f "$MIG063" >/dev/null
else
  echo "063 already applied"
fi
if [ "$(psql_val "select to_regprocedure('public.recall_catchup_eligible_statuses_v1()') is not null")" != "t" ]; then
  echo "applying 064_recall_excused_catchup.sql"
  psql_q -1 -f "$MIG064" >/dev/null
else
  echo "064 already applied"
fi

# --- 3. transactional checks --------------------------------------------------
echo "running lab-checks.sql"
if OUT="$(psql_q -f "$CHECKS" 2>&1)"; then
  printf '%s\n' "$OUT" | grep -E 'PASS' || true
else
  printf '%s\n' "$OUT" | grep -E 'ERROR|FAIL' | head -5 >&2
  echo "lab-checks.sql FAILED" >&2
  exit 1
fi

# --- 4. concurrency checks (committed fixture) ---------------------------------
uuid() { uuidgen | tr 'A-Z' 'a-z'; }
ORG=$(uuid); DEPT=$(uuid); MOD=$(uuid); T1=$(uuid); S_FUT=$(uuid); S_END=$(uuid)
B_SETUP=$(uuid); B_A=$(uuid); B_B=$(uuid)
TMP="$(mktemp -d)"

cleanup() {
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL || true
DELETE FROM public.organizations WHERE id = '$ORG';
DELETE FROM auth.users WHERE id IN ('$MOD', '$T1');
SQL
  rm -rf "$TMP"
}
trap cleanup EXIT

psql_q >/dev/null <<SQL
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('$MOD', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rota-lab-conc-mod-${MOD:0:8}@example.test', now(), now()),
  ('$T1',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rota-lab-conc-t1-${T1:0:8}@example.test', now(), now());
INSERT INTO public.organizations (id, name, created_by) VALUES ('$ORG', 'Rota Lab Concurrency', '$MOD');
INSERT INTO public.departments (id, org_id, name, created_by) VALUES ('$DEPT', '$ORG', 'Rota Lab Concurrency Dept', '$MOD');
INSERT INTO public.organization_members (org_id, user_id, role) VALUES ('$ORG', '$MOD', 'department_admin'), ('$ORG', '$T1', 'trainee');
INSERT INTO public.department_members (org_id, department_id, user_id, role) VALUES
  ('$ORG', '$DEPT', '$MOD', 'department_admin'), ('$ORG', '$DEPT', '$T1', 'trainee');
INSERT INTO public.sessions (id, org_id, department_id, title, date_start, date_end, location_type, status, created_by) VALUES
  ('$S_FUT', '$ORG', '$DEPT', 'Future', now() + interval '2 days', now() + interval '2 days 1 hour', 'IN_PERSON', 'PUBLISHED', '$MOD'),
  ('$S_END', '$ORG', '$DEPT', 'Ended',  now() - interval '3 hours', now() - interval '2 hours', 'IN_PERSON', 'PUBLISHED', '$MOD');
INSERT INTO public.rota_settings (org_id, enabled, dpia_reference, privacy_notice_confirmed_at, enabled_at)
  VALUES ('$ORG', true, 'LAB-DPIA-CONC', now(), now());
INSERT INTO public.rota_departments (department_id, org_id) VALUES ('$DEPT', '$ORG');
INSERT INTO public.rota_match_previews (org_id, department_id, upload_id, caller_user_id, caller_role, people_count) VALUES
  ('$ORG', '$DEPT', '$B_SETUP', '$MOD', 'MODERATOR', 1),
  ('$ORG', '$DEPT', '$B_A', '$MOD', 'MODERATOR', 1),
  ('$ORG', '$DEPT', '$B_B', '$MOD', 'MODERATOR', 1);
SELECT public.ingest_rota_batch_v1('$ORG', '$DEPT', '$MOD',
  jsonb_build_object('id', '$B_SETUP', 'upload_id', '$B_SETUP', 'kind', 'WORKED', 'payload_digest', repeat('c', 64),
                     'range_from', current_date - 3, 'range_to', current_date - 1, 'people_received', 1),
  jsonb_build_array(jsonb_build_object('session_id', '$S_END', 'user_id', '$T1')), '[]', '[]');
SQL

batch_json() { # id kind hashchar
  echo "jsonb_build_object('id', '$1', 'upload_id', '$1', 'kind', '$2', 'payload_digest', repeat('$3', 64), 'range_from', current_date, 'range_to', current_date + 5, 'people_received', 1)"
}

# L6: A holds the org lock for 2 s; B must wait, then commit after A.
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >"$TMP/l6a.out" 2>&1 <<SQL &
BEGIN;
SELECT public.ingest_rota_batch_v1('$ORG', '$DEPT', '$MOD', $(batch_json "$B_A" PLANNED a),
  jsonb_build_array(jsonb_build_object('session_id', '$S_FUT', 'user_id', '$T1')), '[]', '[]');
SELECT pg_sleep(2);
COMMIT;
SQL
PID_A=$!
sleep 0.5
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >"$TMP/l6b.out" 2>&1 <<SQL
DO \$\$
DECLARE t0 timestamptz := clock_timestamp(); v jsonb;
BEGIN
  v := public.ingest_rota_batch_v1('$ORG', '$DEPT', '$MOD', $(batch_json "$B_B" WORKED b),
    jsonb_build_array(jsonb_build_object('session_id', '$S_FUT', 'user_id', '$T1')), '[]', '[]');
  RAISE NOTICE 'L6_WAIT=%', round(extract(epoch FROM clock_timestamp() - t0)::numeric, 2);
END \$\$;
SQL
wait "$PID_A"
WAIT_B=$(sed -n 's/.*L6_WAIT=\([0-9.]*\).*/\1/p' "$TMP/l6b.out")
L6_STATE=$(psql_val "select (select count(*) from public.rota_import_batches where org_id = '$ORG' and id in ('$B_A', '$B_B')) || ':' || (select kind || ':' || batch_id from public.rota_session_flags where session_id = '$S_FUT' and user_id = '$T1')")
if [ "$L6_STATE" != "2:WORKED:$B_B" ] || [ -z "$WAIT_B" ] || ! awk "BEGIN{exit !($WAIT_B >= 1.0)}"; then
  echo "FAIL L6: state=$L6_STATE wait=${WAIT_B:-none}" >&2
  cat "$TMP/l6a.out" "$TMP/l6b.out" >&2
  exit 1
fi
echo "L6 PASS (second ingest waited ${WAIT_B}s; both batches present; WORKED flag from the later commit)"

# L7c: A confirms and holds the session lock for 2 s; B's confirm must fail.
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >"$TMP/l7a.out" 2>&1 <<SQL &
BEGIN;
SELECT (public.confirm_rota_excusal_v1('$ORG', '$S_END', '$T1', '$MOD')).status;
SELECT pg_sleep(2);
COMMIT;
SQL
PID_A=$!
sleep 0.5
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >"$TMP/l7b.out" 2>&1 <<SQL
DO \$\$
BEGIN
  PERFORM public.confirm_rota_excusal_v1('$ORG', '$S_END', '$T1', '$MOD');
  RAISE NOTICE 'L7C_B=succeeded';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'L7C_B=%', SQLERRM;
END \$\$;
SQL
wait "$PID_A"
B_RESULT=$(sed -n 's/.*L7C_B=\(.*\)$/\1/p' "$TMP/l7b.out")
MC_ROWS=$(psql_val "select count(*) from public.attendance_evidence where session_id = '$S_END' and user_id = '$T1' and source = 'MODERATOR_CONFIRMATION'")
STATUS=$(psql_val "select status from public.attendance where session_id = '$S_END' and user_id = '$T1'")
if [ "$B_RESULT" != "rota:suggestion_changed" ] || [ "$MC_ROWS" != "1" ] || [ "$STATUS" != "EXCUSED" ]; then
  echo "FAIL L7c: second=$B_RESULT mc_rows=$MC_ROWS status=$STATUS" >&2
  cat "$TMP/l7a.out" "$TMP/l7b.out" >&2
  exit 1
fi
echo "L7c PASS (one moderator row; the concurrent confirm got rota:suggestion_changed)"

echo "rota lab checks: ALL PASS"
