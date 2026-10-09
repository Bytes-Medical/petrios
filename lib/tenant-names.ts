export const MAX_TENANT_NAME_LENGTH = 120

/** Friendly message for the departments(org_id, name) unique index. */
export const DEPARTMENT_NAME_CONFLICT_MESSAGE =
  'A department with that name already exists in this organisation.'

/** Trim and collapse internal whitespace; non-strings normalize to ''. */
export function normalizeTenantName(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.trim().replace(/\s+/g, ' ')
}

function validateTenantName(input: unknown, label: 'Organisation' | 'Department'): string {
  if (typeof input !== 'string') {
    throw new Error(`${label} name must be text.`)
  }

  const name = normalizeTenantName(input)
  if (!name) {
    throw new Error(`${label} name is required.`)
  }
  if (name.length > MAX_TENANT_NAME_LENGTH) {
    throw new Error(`${label} names are limited to ${MAX_TENANT_NAME_LENGTH} characters.`)
  }

  return name
}

/** Server-action boundary for a user-supplied organisation name. */
export function validateOrganizationName(input: unknown): string {
  return validateTenantName(input, 'Organisation')
}

/** Server-action boundary for a user-supplied department name. */
export function validateDepartmentName(input: unknown): string {
  return validateTenantName(input, 'Department')
}
