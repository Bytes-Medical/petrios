import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/certificates/preview (E7): the department's own organisation,
// resolved by requireDepartmentModerator on the server, scopes the settings
// read and the organisation name printed on the preview.

const state = vi.hoisted(() => ({
  departments: {} as Record<string, string>,
  currentOrgId: 'attacker-org',
  settingsCalls: [] as [string, string][],
  orgNameCalls: [] as string[],
  pdfInput: null as Record<string, unknown> | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => 'attacker',
  requireDepartmentModerator: async (departmentId: string) => {
    const orgId = state.departments[departmentId]
    if (!orgId || orgId !== state.currentOrgId) throw new Error('Department moderator required')
    return { orgId }
  },
}))
vi.mock('@/lib/app-url', () => ({ getAppUrlFromHeaders: async () => 'https://petrios.example' }))
vi.mock('@/lib/certificates/pdf', () => ({
  generateCertificatePDF: async (input: Record<string, unknown>) => {
    state.pdfInput = input
    return Buffer.from('%PDF-preview')
  },
}))
vi.mock('@/lib/db/departments', () => ({
  findDepartmentCertificateSettings: async (departmentId: string, orgId: string) => {
    state.settingsCalls.push([departmentId, orgId])
    return { name: 'Renal', lead_name: null, certificate_coordinator_names: ['Dr A'] }
  },
}))
vi.mock('@/lib/db/organizations', () => ({
  findOrganizationName: async (orgId: string) => {
    state.orgNameCalls.push(orgId)
    return 'Own Trust'
  },
}))

import { GET } from '@/app/api/certificates/preview/route'

function get(departmentId: string) {
  return GET(
    new NextRequest(`https://petrios.example/api/certificates/preview?departmentId=${departmentId}`)
  )
}

beforeEach(() => {
  state.departments = { 'victim-dept': 'victim-org', 'own-dept': 'attacker-org' }
  state.currentOrgId = 'attacker-org'
  state.settingsCalls = []
  state.orgNameCalls = []
  state.pdfInput = null
})

describe('certificate preview route', () => {
  it('refuses another tenant department without reading its settings', async () => {
    const response = await get('victim-dept')
    expect(response.status).toBe(500)
    expect(state.settingsCalls).toEqual([])
    expect(state.pdfInput).toBeNull()
  })

  it('scopes the settings read and org name to the department organisation', async () => {
    const response = await get('own-dept')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(state.settingsCalls).toEqual([['own-dept', 'attacker-org']])
    expect(state.orgNameCalls).toEqual(['attacker-org'])
    expect(state.pdfInput).toMatchObject({ orgName: 'Own Trust', departmentName: 'Renal' })
  })
})
