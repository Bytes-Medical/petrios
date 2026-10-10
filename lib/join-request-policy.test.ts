import { describe, expect, it } from 'vitest'
import {
  isJoinRequestableRole,
  joinRequestBindingError,
  joinRequestEffectiveRole,
  joinRequestGrantRole,
} from './join-request-policy'

describe('joinRequestGrantRole', () => {
  it('grants the stored ordinary role', () => {
    expect(joinRequestGrantRole('trainee')).toBe('trainee')
    expect(joinRequestGrantRole('faculty')).toBe('faculty')
  })

  it('never grants a moderator or admin role, whatever was stored', () => {
    expect(joinRequestGrantRole('org_admin')).toBe('trainee')
    expect(joinRequestGrantRole('department_admin')).toBe('trainee')
    expect(joinRequestGrantRole('super_admin')).toBe('trainee')
    expect(joinRequestGrantRole(null)).toBe('trainee')
    expect(joinRequestGrantRole(undefined)).toBe('trainee')
  })
})

describe('isJoinRequestableRole', () => {
  it('accepts only trainee and faculty', () => {
    expect(isJoinRequestableRole('trainee')).toBe(true)
    expect(isJoinRequestableRole('faculty')).toBe(true)
    expect(isJoinRequestableRole('org_admin')).toBe(false)
    expect(isJoinRequestableRole('department_admin')).toBe(false)
    expect(isJoinRequestableRole(42)).toBe(false)
  })
})

describe('joinRequestBindingError', () => {
  it('requires the department to exist and belong to the request organisation', () => {
    expect(joinRequestBindingError({ requestOrgId: 'org-1', departmentOrgId: 'org-1' })).toBeNull()
    expect(joinRequestBindingError({ requestOrgId: 'org-1', departmentOrgId: null })).toBe(
      'department-missing'
    )
    // An attacker naming a victim org with their own department id.
    expect(joinRequestBindingError({ requestOrgId: 'victim', departmentOrgId: 'attacker' })).toBe(
      'org-mismatch'
    )
  })
})

describe('joinRequestEffectiveRole', () => {
  it('writes the granted role over no role or a lower one', () => {
    expect(joinRequestEffectiveRole(null, 'trainee')).toBe('trainee')
    expect(joinRequestEffectiveRole('trainee', 'faculty')).toBe('faculty')
  })

  it('never demotes a higher existing role', () => {
    expect(joinRequestEffectiveRole('org_admin', 'trainee')).toBe('org_admin')
    expect(joinRequestEffectiveRole('department_admin', 'faculty')).toBe('department_admin')
    expect(joinRequestEffectiveRole('faculty', 'trainee')).toBe('faculty')
  })

  it('ignores unknown stored roles', () => {
    expect(joinRequestEffectiveRole('owner', 'trainee')).toBe('trainee')
  })
})
