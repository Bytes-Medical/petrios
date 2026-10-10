import { describe, expect, it } from 'vitest'
import { decideDepartmentModerator } from '@/lib/department-authz'
import { decideRotaModerator } from './authz'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

describe('decideRotaModerator', () => {
  it('refuses a super admin acting in another organisation, unlike department moderation', () => {
    const facts = { departmentOrgId: ORG_A, currentOrgId: ORG_B, orgAdminOfCurrentOrg: true, moderatorRowOrgIds: [] }
    expect(decideDepartmentModerator({ ...facts, superAdmin: true }).allowed).toBe(true)
    expect(decideRotaModerator(facts)).toEqual({ allowed: false, orgId: null })
    // Super-admin status is not even an input.
    expect(decideRotaModerator({ ...facts, superAdmin: true } as never)).toEqual({ allowed: false, orgId: null })
  })

  it('allows an org admin of the current (department) organisation', () => {
    expect(
      decideRotaModerator({ departmentOrgId: ORG_A, currentOrgId: ORG_A, orgAdminOfCurrentOrg: true, moderatorRowOrgIds: [] })
    ).toEqual({ allowed: true, orgId: ORG_A })
  })

  it('allows a department moderator row in the same organisation', () => {
    expect(
      decideRotaModerator({ departmentOrgId: ORG_A, currentOrgId: ORG_A, orgAdminOfCurrentOrg: false, moderatorRowOrgIds: [ORG_A] })
    ).toEqual({ allowed: true, orgId: ORG_A })
  })

  it('refuses a cross-organisation moderator row and a missing department', () => {
    expect(
      decideRotaModerator({ departmentOrgId: ORG_A, currentOrgId: ORG_A, orgAdminOfCurrentOrg: false, moderatorRowOrgIds: [ORG_B] })
        .allowed
    ).toBe(false)
    expect(
      decideRotaModerator({ departmentOrgId: ORG_A, currentOrgId: ORG_B, orgAdminOfCurrentOrg: false, moderatorRowOrgIds: [ORG_A] })
        .allowed
    ).toBe(false)
    expect(
      decideRotaModerator({ departmentOrgId: null, currentOrgId: ORG_A, orgAdminOfCurrentOrg: true, moderatorRowOrgIds: [ORG_A] })
        .allowed
    ).toBe(false)
  })

  it('refuses a plain member', () => {
    expect(
      decideRotaModerator({ departmentOrgId: ORG_A, currentOrgId: ORG_A, orgAdminOfCurrentOrg: false, moderatorRowOrgIds: [] })
        .allowed
    ).toBe(false)
  })
})
