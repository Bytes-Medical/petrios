import { describe, expect, it } from 'vitest'
import { decideDepartmentModerator, type DepartmentModeratorFacts } from './department-authz'

const base: DepartmentModeratorFacts = {
  departmentOrgId: 'org-victim',
  currentOrgId: 'org-attacker',
  superAdmin: false,
  orgAdminOfCurrentOrg: false,
  moderatorRowOrgIds: [],
}

describe('decideDepartmentModerator', () => {
  it('denies an org admin of another organisation (self-signup workspace attacker)', () => {
    expect(decideDepartmentModerator({ ...base, orgAdminOfCurrentOrg: true })).toEqual({
      allowed: false,
      orgId: null,
    })
  })

  it('denies a moderator row whose org_id disagrees with the department (planted row)', () => {
    expect(
      decideDepartmentModerator({
        ...base,
        currentOrgId: 'org-attacker',
        orgAdminOfCurrentOrg: true,
        moderatorRowOrgIds: ['org-attacker'],
      }).allowed
    ).toBe(false)
    // Even working "in" the victim org, a row stamped with another org never counts.
    expect(
      decideDepartmentModerator({
        ...base,
        currentOrgId: 'org-victim',
        moderatorRowOrgIds: ['org-attacker'],
      }).allowed
    ).toBe(false)
  })

  it('allows the org admin of the department organisation and returns that org', () => {
    expect(
      decideDepartmentModerator({
        ...base,
        currentOrgId: 'org-victim',
        orgAdminOfCurrentOrg: true,
      })
    ).toEqual({ allowed: true, orgId: 'org-victim' })
  })

  it('allows a department moderator row in the department organisation', () => {
    expect(
      decideDepartmentModerator({
        ...base,
        currentOrgId: 'org-victim',
        moderatorRowOrgIds: ['org-victim'],
      })
    ).toEqual({ allowed: true, orgId: 'org-victim' })
  })

  it('requires the department organisation to be the caller current org', () => {
    // A real moderator of the department whose current org is elsewhere is
    // denied: their requireOrg()-scoped follow-up queries would not line up.
    expect(
      decideDepartmentModerator({
        ...base,
        currentOrgId: 'org-personal',
        moderatorRowOrgIds: ['org-victim'],
      }).allowed
    ).toBe(false)
    expect(
      decideDepartmentModerator({ ...base, currentOrgId: null, moderatorRowOrgIds: ['org-victim'] })
        .allowed
    ).toBe(false)
  })

  it('allows a super admin anywhere but never for a missing department', () => {
    expect(decideDepartmentModerator({ ...base, superAdmin: true })).toEqual({
      allowed: true,
      orgId: 'org-victim',
    })
    expect(
      decideDepartmentModerator({ ...base, departmentOrgId: null, superAdmin: true }).allowed
    ).toBe(false)
  })
})
