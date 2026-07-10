/**
 * Public-API scopes — client-safe constants (imported by the Settings UI
 * as well as the server-only auth layer in lib/api/auth.ts).
 */
export const API_SCOPES = [
  'read:sessions',
  'write:sessions',
  'read:attendance',
  'read:certificates',
  'read:departments',
  'read:slots',
] as const

export type ApiScope = (typeof API_SCOPES)[number]
