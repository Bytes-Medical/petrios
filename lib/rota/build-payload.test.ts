import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRotaBatches } from './build-payload'
import { canonicalRotaJson } from './canonical'
import { parseCsv } from './csv'
import { buildDayTemplates, RotaTemplateRegistry } from './dictionary'
import { extractRotaRows } from './mapping'
import { rotaProfileConfigSchema } from './profile'
import { validateRotaBatch } from './schema'

const fixture = (name: string) => readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')
const TODAY = '2026-10-12'
const IDS = { worked: '11111111-1111-4111-8111-111111111111', planned: '22222222-2222-4222-8222-222222222222' }

function buildFromFixture() {
  const profile = rotaProfileConfigSchema.parse(JSON.parse(fixture('synthetic-profile.json')))
  const range = { from: '2026-09-28', to: '2026-12-07' }
  const extraction = extractRotaRows(parseCsv(fixture('synthetic-wide.csv')), profile, range)
  const registry = new RotaTemplateRegistry()
  const people = extraction.people.map((p) => ({
    ref: p.ref,
    staffKey: p.staffKey,
    email: p.email,
    days: buildDayTemplates(p, profile, range, registry).days,
  }))
  return buildRotaBatches({ people, templates: registry.templates, range, todayKey: TODAY, batchIds: IDS })
}

describe('buildRotaBatches', () => {
  it('splits one file into WORKED (past) and PLANNED (today onwards)', () => {
    const { worked, planned } = buildFromFixture()
    expect(worked?.range).toEqual({ from: '2026-09-28', to: '2026-10-11' })
    expect(planned?.range).toEqual({ from: '2026-10-12', to: '2026-12-07' })
    expect(worked?.people[0].days).toHaveLength(14)
    expect(planned?.people[0].days).toHaveLength(57)
    expect(worked?.batch_id).toBe(IDS.worked)
    expect(planned?.kind).toBe('PLANNED')
    for (const batch of [worked, planned]) {
      expect(validateRotaBatch(batch, { todayKey: TODAY, horizonDays: 56, callerRole: 'UPLOADER' }).ok).toBe(true)
    }
  })

  it('emits only schema keys: no names, codes or extra columns', () => {
    const { worked, planned } = buildFromFixture()
    for (const batch of [worked!, planned!]) {
      const json = canonicalRotaJson(batch)
      expect(Object.keys(JSON.parse(json)).sort()).toEqual(['batch_id', 'kind', 'people', 'range', 'templates', 'v'])
      for (const person of batch.people) {
        for (const key of Object.keys(person)) expect(['ref', 'staff_key', 'email', 'days']).toContain(key)
      }
      for (const forbidden of ['Tess', 'Ghost', 'Name', '"SD"', '"AL"', '"OFF"', 'Staff Number', '10000001-1']) {
        expect(json).not.toContain(forbidden)
      }
      const used = new Set(batch.people.flatMap((p) => p.days.split('')))
      for (const id of Object.keys(batch.templates)) expect(used.has(id)).toBe(true)
    }
  })

  it('returns null for an empty side', () => {
    const result = buildRotaBatches({
      people: [{ ref: 'r0', staffKey: 'A', days: '..' }],
      templates: {},
      range: { from: '2026-10-12', to: '2026-10-13' },
      todayKey: TODAY,
      batchIds: IDS,
    })
    expect(result.worked).toBeNull()
    expect(result.planned?.people[0].days).toBe('..')
  })
})
