// Static checks on migration 062 (supabase/migrations/062_lock_down_public_rls.sql)
// and its runbook. No database is involved: these read the SQL text and guard
// the invariants that review found easy to break (spec/02, spec/13,
// docs/security/rls-lockdown.md).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..', '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const MIGRATION = '062_lock_down_public_rls.sql'

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

const raw = readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
const sql = stripComments(raw)
const runbook = readFileSync(path.join(root, 'docs', 'security', 'rls-lockdown.md'), 'utf8')

interface Policy {
  name: string
  table: string
  command: string
  roles: string | null
  body: string
}

function policies(): Policy[] {
  const re =
    /CREATE POLICY "([^"]+)"\s+ON\s+(public\.\w+)\s+FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)(?:\s+TO\s+(\w+))?([\s\S]*?);/g
  return [...sql.matchAll(re)].map((m) => ({
    name: m[1],
    table: m[2],
    command: m[3],
    roles: m[4] ?? null,
    body: m[5],
  }))
}

describe('migration 062 shape', () => {
  it('has no transaction control of its own (scripts/migrate.mjs wraps it)', () => {
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
  })

  it('restricts every new policy to authenticated', () => {
    const all = policies()
    expect(all.length).toBeGreaterThan(20)
    for (const p of all) expect(p.roles, p.name).toBe('authenticated')
  })

  it('drops every policy before creating it (idempotent re-run)', () => {
    for (const p of policies()) {
      const create = sql.indexOf(`CREATE POLICY "${p.name}"\n    ON ${p.table}`)
      const drop = sql.indexOf(`DROP POLICY IF EXISTS "${p.name}" ON ${p.table};`)
      expect(drop, p.name).toBeGreaterThanOrEqual(0)
      expect(drop, p.name).toBeLessThan(create)
    }
  })

  it('adds no SELECT visibility to membership tables beyond the first-org-admin reach', () => {
    const membership = policies().filter((p) =>
      ['public.organization_members', 'public.department_members'].includes(p.table)
    )
    // FOR ALL also grants SELECT, which would change getCurrentOrgId().
    expect(membership.filter((p) => p.command === 'ALL')).toEqual([])
    for (const p of membership.filter((x) => x.command === 'SELECT')) {
      expect(p.table, p.name).toBe('public.organization_members')
      // Only users who are admin of their first organisation (who already saw
      // every row before 062) gain these rows.
      // A conjunct, never an alternative.
      expect(p.body, p.name).toMatch(/public\.is_org_admin\(\)/)
      expect(p.body, p.name).toMatch(/\bAND\b/)
      expect(p.body, p.name).not.toMatch(/\bOR\b/)
    }
  })

  it('gives org admins no INSERT policy on organization_members', () => {
    expect(
      policies().filter(
        (p) => p.table === 'public.organization_members' && p.command === 'INSERT'
      )
    ).toEqual([])
    expect(sql).toMatch(/REVOKE UPDATE ON public\.organization_members FROM authenticated;/)
    expect(sql).toMatch(/GRANT UPDATE \(role\) ON public\.organization_members TO authenticated;/)
  })

  it('binds department_members writes to a department of the same organisation', () => {
    const writes = policies().filter(
      (p) => p.table === 'public.department_members' && p.command !== 'DELETE'
    )
    expect(writes.map((p) => p.command).sort()).toEqual(['INSERT', 'UPDATE'])
    for (const p of writes) {
      expect(p.body).toMatch(/WITH CHECK[\s\S]*is_department_moderator_in\(org_id, department_id\)/)
      expect(p.body).toMatch(/om\.user_id = department_members\.user_id/)
    }
    expect(sql).toMatch(
      /ADD CONSTRAINT department_members_department_org_fkey\s+FOREIGN KEY \(department_id, org_id\)/
    )
  })

  it('uses is_org_admin() alone in no new policy', () => {
    for (const p of policies()) {
      if (!/is_org_admin\(\)/.test(p.body)) continue
      // The only sanctioned uses preserve first-organisation semantics.
      expect(p.table, p.name).toBe('public.organization_members')
      expect(p.command, p.name).toBe('SELECT')
    }
  })

  it('fires the department-code guard before the code generator', () => {
    const guard = /CREATE TRIGGER (\w+)\s+BEFORE INSERT OR UPDATE OF department_code/.exec(sql)
    const assign = /CREATE TRIGGER (\w+)\s+BEFORE INSERT ON public\.departments/.exec(sql)
    expect(guard?.[1]).toBeDefined()
    expect(assign?.[1]).toBeDefined()
    // BEFORE triggers fire in name order.
    expect(guard![1] < assign![1]).toBe(true)
    // The guard reads current_user, so it must run as the caller.
    const guardFn = /FUNCTION public\.guard_department_code\(\)[\s\S]*?\$\$ LANGUAGE[^;]*;/.exec(sql)
    expect(guardFn?.[0]).toBeDefined()
    expect(guardFn![0]).not.toMatch(/SECURITY DEFINER/)
    expect(guardFn![0]).toMatch(/current_user IN \('anon', 'authenticated'\)/)
  })

  it('draws department codes from gen_random_uuid(), not RANDOM()', () => {
    const fn = /FUNCTION public\.assign_department_code\(\)[\s\S]*?\$\$ LANGUAGE[^;]*;/.exec(sql)
    expect(fn?.[0]).toMatch(/gen_random_uuid\(\)/)
    expect(fn?.[0]).not.toMatch(/RANDOM\(\)/)
  })

  it('revokes RPCs by name, not by exact signature', () => {
    expect(sql).not.toMatch(/to_regprocedure\('public\.record_attendance_evidence_v2/)
    expect(sql).toMatch(/p\.proname = ANY \(ARRAY\[/)
  })
})

describe('SECURITY DEFINER functions across all migrations', () => {
  // Helpers that only answer questions about the caller (auth.uid()); policies
  // call them as the querying role, so browser roles must keep EXECUTE.
  const CALLER_HELPERS = new Set([
    'can_view_session',
    'get_user_org_id',
    'is_org_admin',
    'is_super_admin',
    'is_department_admin',
    'is_session_faculty',
    'is_org_member_of',
    'is_org_admin_of',
    'is_department_moderator_in',
    'is_session_moderator_in',
  ])

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const texts = files.map((f) => stripComments(readFileSync(path.join(migrationsDir, f), 'utf8')))

  // Last definition wins, as when migrations are applied in order.
  const definer = new Map<string, boolean>()
  for (const text of texts) {
    const re =
      /CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\$\$[\s\S]*?\$\$([^;]*);/gi
    for (const m of text.matchAll(re)) {
      const header = m[2]
      const tail = m[3]
      const returnsTrigger = /RETURNS\s+TRIGGER/i.test(header)
      const isDefiner = /SECURITY DEFINER/i.test(header) || /SECURITY DEFINER/i.test(tail)
      definer.set(m[1], isDefiner && !returnsTrigger)
    }
  }

  const all = texts.join('\n')
  const revokedByName = new Set(
    [...(/p\.proname = ANY \(ARRAY\[([\s\S]*?)\]\)/.exec(sql)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(
      (m) => m[1]
    )
  )

  it('closes every non-helper SECURITY DEFINER function to anon and authenticated', () => {
    const open: string[] = []
    for (const [name, isDefiner] of definer) {
      if (!isDefiner || CALLER_HELPERS.has(name)) continue
      const revokedExplicitly = new RegExp(
        `REVOKE ALL ON FUNCTION (?:public\\.)?${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated`
      ).test(all)
      if (!revokedExplicitly && !revokedByName.has(name)) open.push(name)
    }
    expect(open).toEqual([])
  })
})

describe('runbook stays in step with the migration', () => {
  it('names every policy 062 creates (expected state and rollback)', () => {
    for (const p of policies()) expect(runbook, p.name).toContain(p.name)
  })

  it('names the new constraints and triggers', () => {
    for (const name of [
      'sessions_department_org_fkey',
      'department_members_department_org_fkey',
      'departments_assign_code',
      'departments_aa_guard_code',
      'guard_department_code',
    ]) {
      expect(runbook, name).toContain(name)
    }
  })

  it('applies with a lock timeout', () => {
    expect(runbook).toMatch(/BEGIN;\s*\n\s*SET LOCAL lock_timeout = '3s';/)
  })
})
