import { describe, expect, it } from 'vitest'
import {
  canReadOrgScope,
  decideDepartmentModerator,
  departmentMemberRemovalBlock,
  type DepartmentModeratorFacts,
} from './department-authz'

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

describe('canReadOrgScope', () => {
  it('serves only the current org unless super admin', () => {
    expect(canReadOrgScope({ requestedOrgId: 'a', currentOrgId: 'a', superAdmin: false })).toBe(true)
    expect(canReadOrgScope({ requestedOrgId: 'b', currentOrgId: 'a', superAdmin: false })).toBe(false)
    expect(canReadOrgScope({ requestedOrgId: 'b', currentOrgId: null, superAdmin: false })).toBe(false)
    expect(canReadOrgScope({ requestedOrgId: 'b', currentOrgId: 'a', superAdmin: true })).toBe(true)
    expect(canReadOrgScope({ requestedOrgId: '', currentOrgId: '', superAdmin: true })).toBe(false)
  })
})

describe('departmentMemberRemovalBlock', () => {
  it('requires the target to be a member of this department', () => {
    expect(departmentMemberRemovalBlock({ departmentRole: null, orgRole: 'trainee' })).toBe(
      'not-a-member'
    )
  })

  it('protects administrators by department or organisation role', () => {
    expect(departmentMemberRemovalBlock({ departmentRole: 'department_admin', orgRole: 'faculty' })).toBe(
      'protected-role'
    )
    expect(departmentMemberRemovalBlock({ departmentRole: 'org_admin', orgRole: 'org_admin' })).toBe(
      'protected-role'
    )
    expect(departmentMemberRemovalBlock({ departmentRole: 'trainee', orgRole: 'org_admin' })).toBe(
      'protected-role'
    )
  })

  it('protects a moderator of another department in the same organisation', () => {
    // Removal deletes the organisation membership too: a peer moderator who is
    // an ordinary member here must not be evictable from this panel.
    expect(
      departmentMemberRemovalBlock({ departmentRole: 'trainee', orgRole: 'department_admin' })
    ).toBe('protected-role')
    expect(
      departmentMemberRemovalBlock({
        departmentRole: 'trainee',
        orgRole: 'trainee',
        moderatesAnyDepartmentInOrg: true,
      })
    ).toBe('protected-role')
  })

  it('allows ordinary members', () => {
    expect(departmentMemberRemovalBlock({ departmentRole: 'trainee', orgRole: 'trainee' })).toBeNull()
    expect(departmentMemberRemovalBlock({ departmentRole: 'faculty', orgRole: null })).toBeNull()
  })
})
