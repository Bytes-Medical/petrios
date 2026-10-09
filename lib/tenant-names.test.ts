import { describe, expect, it } from 'vitest'
import {
  MAX_TENANT_NAME_LENGTH,
  normalizeTenantName,
  validateDepartmentName,
  validateOrganizationName,
} from './tenant-names'

describe('normalizeTenantName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeTenantName('  Acute   Medicine \n')).toBe('Acute Medicine')
  })

  it('normalizes non-strings to an empty string', () => {
    expect(normalizeTenantName(undefined)).toBe('')
    expect(normalizeTenantName(42)).toBe('')
  })
})

describe('validateOrganizationName', () => {
  it('returns the normalized name', () => {
    expect(validateOrganizationName('  Sheffield  Teaching Hospitals ')).toBe(
      'Sheffield Teaching Hospitals'
    )
  })

  it('rejects empty and non-string input', () => {
    expect(() => validateOrganizationName('   ')).toThrow('Organisation name is required.')
    expect(() => validateOrganizationName(null)).toThrow('Organisation name must be text.')
  })

  it('rejects names over the limit', () => {
    expect(validateOrganizationName('a'.repeat(MAX_TENANT_NAME_LENGTH))).toHaveLength(
      MAX_TENANT_NAME_LENGTH
    )
    expect(() => validateOrganizationName('a'.repeat(MAX_TENANT_NAME_LENGTH + 1))).toThrow(
      `limited to ${MAX_TENANT_NAME_LENGTH} characters`
    )
  })
})

describe('validateDepartmentName', () => {
  it('labels errors as department', () => {
    expect(() => validateDepartmentName('')).toThrow('Department name is required.')
  })

  it('returns the normalized name', () => {
    expect(validateDepartmentName(' Paediatrics ')).toBe('Paediatrics')
  })
})
