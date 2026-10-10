// Static checks on migrations 063 (rota availability) and 064 (Recall for
// EXCUSED + latest moderator decision). No database is involved: these read
// the SQL text and guard invariants that are easy to break in review (spec/02,
// spec/14, CLAUDE.md "Database"). Behaviour is checked in the lab by
// scripts/rota/run-lab-checks.sh.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..', '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

const raw063 = readFileSync(path.join(migrationsDir, '063_rota_availability.sql'), 'utf8')
const raw064 = readFileSync(path.join(migrationsDir, '064_recall_excused_catchup.sql'), 'utf8')
const raw045 = readFileSync(path.join(migrationsDir, '045_attendance_v2.sql'), 'utf8')
const raw059 = readFileSync(path.join(migrationsDir, '059_recall_catchup_attendance.sql'), 'utf8')
const sql063 = stripComments(raw063)
const sql064 = stripComments(raw064)

const ROTA_TABLES = [
  'rota_settings',
  'rota_departments',
  'rota_uploaders',
  'rota_upload_profiles',
  'rota_identity_links',
  'rota_import_batches',
  'rota_match_previews',
  'rota_session_flags',
]

interface FnDef {
  name: string
  args: string
  body: string
  securityDefiner: boolean
  searchPath: boolean
}

/** Every CREATE [OR REPLACE] FUNCTION with its argument list and attributes. */
function functions(sql: string): FnDef[] {
  const out: FnDef[] = []
  const re = /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*RETURNS\b([\s\S]*?)\$\$([\s\S]*?)\$\$([^;]*);/gi
  for (const m of sql.matchAll(re)) {
    const attributes = `${m[3]} ${m[5]}`
    out.push({
      name: m[1],
      args: m[2],
      body: m[4],
      securityDefiner: /SECURITY\s+DEFINER/i.test(attributes),
      searchPath: /SET\s+search_path\s*=\s*public/i.test(attributes),
    })
  }
  return out
}

/** Argument types only, normalised ("p_org_id uuid DEFAULT NULL" → "uuid"). */
function argTypes(args: string): string {
  return args
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => a.replace(/\s+DEFAULT\s+[\s\S]*$/i, '').trim().split(/\s+/).slice(1).join(' ').toLowerCase())
    .join(',')
}

function normaliseSig(sig: string): string {
  return sig.replace(/\s+/g, '').toLowerCase()
}

function revokes(sql: string): string[] {
  return [...sql.matchAll(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.(\w+)\s*\(([\s\S]*?)\)\s+FROM\s+([^;]+);/gi)].map(
    (m) => `${m[1]}(${normaliseSig(m[2])})|${m[3].replace(/\s+/g, ' ').trim()}`
  )
}

function grants(sql: string): string[] {
  return [...sql.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.(\w+)\s*\(([\s\S]*?)\)\s+TO\s+([^;]+);/gi)].map(
    (m) => `${m[1]}(${normaliseSig(m[2])})|${m[3].trim()}`
  )
}

describe.each([
  ['063', sql063],
  ['064', sql064],
])('migration %s shape', (_label, sql) => {
  it('has no transaction control of its own (scripts/migrate.mjs wraps it)', () => {
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).not.toMatch(/\bCONCURRENTLY\b/i)
  })

  it('creates no RLS policy', () => {
    expect(sql).not.toMatch(/CREATE\s+POLICY/i)
  })

  it('revokes every function from PUBLIC, anon and authenticated and grants it to service_role only', () => {
    const fns = functions(sql)
    expect(fns.length).toBeGreaterThan(0)
    const r = revokes(sql)
    const g = grants(sql)
    for (const fn of fns) {
      const sig = `${fn.name}(${normaliseSig(argTypes(fn.args))})`
      expect(r, sig).toContain(`${sig}|PUBLIC, anon, authenticated`)
      expect(g, sig).toContain(`${sig}|service_role`)
    }
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[^;]*TO\s+[^;]*\b(anon|authenticated|PUBLIC)\b/i)
  })

  it('pins search_path on every SECURITY DEFINER function', () => {
    for (const fn of functions(sql).filter((f) => f.securityDefiner)) {
      expect(fn.searchPath, fn.name).toBe(true)
    }
  })
})

describe('migration 063', () => {
  it('enables RLS, revokes and grants service_role on every rota table and the view', () => {
    for (const table of ROTA_TABLES) {
      expect(sql063, table).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(`))
      expect(sql063, table).toContain(`'${table}'`)
    }
    expect(sql063).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql063).toMatch(/REVOKE ALL ON public\.%I FROM PUBLIC, anon, authenticated/)
    expect(sql063).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.%I TO service_role/)
    expect(sql063).toMatch(/REVOKE ALL ON public\.rota_visible_session_flags FROM PUBLIC, anon, authenticated/)
    expect(sql063).toMatch(/GRANT SELECT ON public\.rota_visible_session_flags TO service_role/)
    // The lockdown loop lists exactly the created tables.
    const loop = sql063.slice(sql063.indexOf('FOREACH t IN ARRAY ARRAY['), sql063.indexOf('LOOP', sql063.indexOf('FOREACH t IN ARRAY ARRAY[')))
    const listed = [...loop.matchAll(/'(rota_\w+)'/g)].map((m) => m[1]).sort()
    const created = [...sql063.matchAll(/CREATE TABLE IF NOT EXISTS public\.(rota_\w+)/g)].map((m) => m[1]).sort()
    expect(listed).toEqual(created)
    expect(created).toEqual([...ROTA_TABLES].sort())
  })

  it('makes the read view security_invoker', () => {
    expect(sql063).toMatch(/CREATE OR REPLACE VIEW public\.rota_visible_session_flags WITH \(security_invoker = true\)/)
  })

  it('is safe to re-run (every table, index and view create is idempotent)', () => {
    expect(sql063).not.toMatch(/^CREATE (TABLE|INDEX|UNIQUE INDEX|VIEW) (?!IF NOT EXISTS)/m)
    expect(sql063).not.toMatch(/^CREATE (TRIGGER|TYPE|POLICY)\b/m)
    expect(sql063).not.toMatch(/^CREATE FUNCTION\b/m)
  })

  it('stores no category, name, email or identifier in clear (O3, D1, D3)', () => {
    expect(sql063).not.toMatch(/\bcategory\s+(text|rota_status|varchar)/i)
    expect(sql063).not.toMatch(/'category'/i)
    expect(sql063).not.toMatch(/show_category|study_leave_split|rota_status/i)
    expect(sql063).not.toMatch(/\b(email|staff_key|full_name)\s+text/i)
    expect(sql063).toMatch(/key_type IN \('STAFF_ID', 'EMAIL'\)/)
    expect(sql063).not.toMatch(/'NAME'/)
    expect(sql063).toMatch(/key_hmac ~ '\^\[0-9a-f\]\{64\}\$'/)
  })

  it('requires governance before enabling and refuses cross-org departments', () => {
    expect(sql063).toMatch(/CHECK \(NOT enabled OR \(dpia_reference IS NOT NULL AND privacy_notice_confirmed_at IS NOT NULL\)\)/)
    expect(sql063).toMatch(/FOREIGN KEY \(department_id, org_id\)\s+REFERENCES public\.departments\(id, org_id\)/)
  })

  it('never interpolates values into rota RPC errors', () => {
    const raises = [...sql063.matchAll(/RAISE\s+EXCEPTION[^;]*;/gi)].map((m) => m[0])
    expect(raises.length).toBeGreaterThan(5)
    for (const raise of raises) {
      expect(raise).toMatch(/^RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rota:[a-z_]+';$/)
      expect(raise).not.toContain('%')
    }
    const codes = new Set(raises.map((r) => /'rota:([a-z_]+)'/.exec(r)![1]))
    expect([...codes].sort()).toEqual(
      [
        'already_decided', 'batch_conflict', 'caught_up', 'disabled', 'invalid_payload', 'not_confirmable',
        'not_eligible', 'not_found', 'presence_evidence', 'preview_required', 'suggestion_changed',
      ].sort()
    )
  })

  it('serialises ingest per org and versions every RPC', () => {
    expect(sql063).toMatch(/pg_advisory_xact_lock\(hashtextextended\('rota:' \|\| p_org_id::text, 0\)\)/)
    const definers = functions(sql063).filter((f) => f.securityDefiner).map((f) => f.name).sort()
    expect(definers).toEqual(
      [
        'confirm_rota_excusal_v1', 'contest_rota_flag_v1', 'disable_rota_for_org_v1', 'dismiss_rota_suggestion_v1',
        'ingest_rota_batch_v1', 'link_rota_identity_v1', 'purge_rota_data_v1', 'record_rota_match_preview_v1',
      ].sort()
    )
    for (const name of ['rota_is_department_trainee', 'rota_apply_identity_link']) {
      expect(functions(sql063).find((f) => f.name === name)!.securityDefiner, name).toBe(false)
    }
    // The moderator link RPC takes the same per-org lock as the ingest.
    const link = functions(sql063).find((f) => f.name === 'link_rota_identity_v1')!.body
    expect(link).toMatch(/pg_advisory_xact_lock\(hashtextextended\('rota:' \|\| p_org_id::text, 0\)\)/)
  })

  it('bounds the membership oracle: one preview per upload, a per-caller locked daily limit, previews required', () => {
    const preview = functions(sql063).find((f) => f.name === 'record_rota_match_preview_v1')!.body
    expect(preview).toMatch(/pg_advisory_xact_lock\(hashtextextended\('rota-preview:' \|\| p_caller_user_id::text, 0\)\)/)
    expect(preview).toMatch(/interval '24 hours'/)
    expect(sql063).toMatch(/CONSTRAINT rota_match_previews_org_upload_key UNIQUE \(org_id, upload_id\)/)
    expect(sql063).toMatch(/CONSTRAINT rota_import_batches_upload_kind_key UNIQUE \(org_id, upload_id, kind\)/)
    const ingest = functions(sql063).find((f) => f.name === 'ingest_rota_batch_v1')!.body
    expect(ingest).toContain("MESSAGE = 'rota:preview_required'")
    expect(ingest).toMatch(/p\.caller_user_id = p_actor_user_id/)
    // The size cap follows sessions, not days.
    expect(ingest).not.toMatch(/500 \* v_days/)
    expect(ingest).toMatch(/GROUP BY u\.session_id/)
  })

  it('stores a keyed batch digest, never a plain payload hash', () => {
    expect(sql063).toMatch(/payload_digest text NOT NULL/)
    expect(sql063).not.toMatch(/payload_sha256/)
  })

  it('writes flags only for PUBLISHED sessions', () => {
    const ingest = functions(sql063).find((f) => f.name === 'ingest_rota_batch_v1')!.body
    expect(ingest).not.toMatch(/s\.status <> 'CANCELLED'/)
    expect((ingest.match(/s\.status = 'PUBLISHED'/g) ?? []).length).toBe(3)
  })

  it('records dismissals and contests as lasting activity events without a category', () => {
    for (const [name, event] of [
      ['dismiss_rota_suggestion_v1', 'ROTA_SUGGESTION_DISMISSED'],
      ['contest_rota_flag_v1', 'ROTA_FLAG_CONTESTED'],
    ]) {
      const body = functions(sql063).find((f) => f.name === name)!.body
      expect(body, name).toContain(`'${event}'`)
      expect(body, name).toMatch(/state = 'OPEN'/)
      expect(body, name).not.toMatch(/category/i)
    }
  })

  it('confirms through record_attendance_evidence_v2 with the deterministic key and no category', () => {
    const confirm = functions(sql063).find((f) => f.name === 'confirm_rota_excusal_v1')!.body
    expect(confirm).toContain("'MODERATOR_CONFIRMATION'")
    expect(confirm).toContain("'status_override', 'EXCUSED'")
    expect(confirm).toContain("'reason_code', 'ROTA_UNAVAILABLE'")
    expect(confirm).toContain("'rota_batch_id', v_flag.batch_id")
    expect(confirm).toContain("'ROTA_EXCUSAL:' || p_session_id::text || ':' || p_user_id::text || ':' || v_session.attendance_revision::text")
    expect(confirm).toContain("'Rostered unavailable (rota)'")
    expect(confirm).toMatch(/FOR UPDATE/)
    expect(confirm).toMatch(/state = 'OPEN'/)
    expect(confirm).not.toMatch(/category/i)
    // A completed catch-up is a decision (reopen after RECALL).
    expect(confirm).toMatch(/ev\.source = 'RECALL'[\s\S]*?'rota:caught_up'/)
    // O2: never confirm an excusal unless 064 keeps EXCUSED trainees' catch-up.
    expect(confirm).toContain("'EXCUSED' = ANY (public.recall_catchup_eligible_statuses_v1())")
  })

  it('is applied after 062 (composite department FK target)', () => {
    expect(raw063).toMatch(/Requires 062/)
  })
})

describe('migration 064', () => {
  const fns = functions(sql064)
  const fn045 = functions(stripComments(raw045)).find((f) => f.name === 'record_attendance_evidence_v2')!
  const fn059 = functions(stripComments(raw059)).find((f) => f.name === 'complete_recall_catchup_v2')!
  const evidence = fns.find((f) => f.name === 'record_attendance_evidence_v2')!
  const catchup = fns.find((f) => f.name === 'complete_recall_catchup_v2')!

  it('keeps the exact 045 and 059 signatures', () => {
    expect(argTypes(evidence.args)).toBe(argTypes(fn045.args))
    expect(argTypes(catchup.args)).toBe(argTypes(fn059.args))
    expect(sql064).toMatch(/record_attendance_evidence_v2\([\s\S]*?\) RETURNS public\.attendance AS \$\$/)
    expect(sql064).toMatch(/complete_recall_catchup_v2\([\s\S]*?\) RETURNS public\.recall_completions AS \$\$/)
  })

  it('changes only the primary-row selection of the evidence writer', () => {
    const before = fn045.body.slice(0, fn045.body.indexOf('SELECT ev.* INTO v_primary'))
    const after045 = fn045.body.slice(fn045.body.indexOf('IF v_primary.id IS NULL THEN'))
    const after064 = evidence.body.slice(evidence.body.indexOf('IF v_primary.id IS NULL THEN'))
    const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
    const declares = (s: string) =>
      squash(s).replace(' v_latest_mc public.attendance_evidence%ROWTYPE; v_recall public.attendance_evidence%ROWTYPE;', '')
    expect(declares(evidence.body.slice(0, evidence.body.indexOf('SELECT ev.* INTO v_latest_mc')))).toBe(squash(before))
    expect(squash(after064)).toBe(squash(after045))
  })

  it('picks the latest moderator decision and lets a later RECALL beat ABSENT/EXCUSED (status-keyed)', () => {
    expect(evidence.body).toMatch(/ev\.source = 'MODERATOR_CONFIRMATION'\s+ORDER BY ev\.observed_at DESC, ev\.created_at DESC, ev\.id DESC/)
    expect(evidence.body).toMatch(/v_latest_mc\.metadata->>'status_override' IN \('ABSENT', 'EXCUSED'\)/)
    expect(evidence.body).toMatch(/ev\.source = 'RECALL'\s+AND ev\.observed_at > v_latest_mc\.observed_at/)
    expect(evidence.body).not.toMatch(/reason_code/)
  })

  it('widens catch-up to EXCUSED with no reason-code branch and keeps the other guards', () => {
    const normalise = (s: string) =>
      s
        .replace(
          "v_attendance.status NOT IN ('ABSENT', 'EXCUSED')",
          "v_attendance.status <> 'ABSENT'"
        )
        .replace(
          'Only a current finalized absence or excusal can use catch-up recognition',
          'Only a current finalized absence can use catch-up recognition'
        )
    expect(normalise(catchup.body)).toBe(fn059.body)
    expect(catchup.body).toContain("sp.participant_role = 'ATTENDEE' AND sp.expectation = 'EXPECTED'")
    expect(catchup.body).toContain("st.status = 'ACCEPTED'")
    expect(catchup.body).not.toMatch(/reason_code/)
  })

  it('re-opens only still-open catch-up sends so EXCUSED attendees of earlier packages are invited', () => {
    expect(sql064).toMatch(
      /UPDATE public\.recall_question_sets\s+SET sent_catchup_at = NULL\s+WHERE status = 'approved'\s+AND sent_catchup_at IS NOT NULL\s+AND catchup_closes_at IS NOT NULL\s+AND catchup_closes_at > now\(\);/
    )
    expect(sql064).not.toMatch(/sent_attendees_at\s*=\s*NULL|sent_boost_at\s*=\s*NULL/)
  })

  it('adds the eligible-status marker', () => {
    expect(sql064).toMatch(
      /recall_catchup_eligible_statuses_v1\(\)\s+RETURNS text\[\][\s\S]*?SELECT ARRAY\['ABSENT', 'EXCUSED'\]::text\[\]/
    )
  })
})
