/**
 * Pure helpers for the external-contacts address book. Kept free of I/O so
 * the merge semantics (invite-time capture fills blanks; RSVP/claim
 * self-reported names overwrite) stay unit-testable.
 */

export interface ContactNameFields {
  first_name: string | null
  last_name: string | null
  role_note?: string | null
}

export interface IncomingContactNames {
  firstName?: string | null
  lastName?: string | null
  roleNote?: string | null
}

export function normalizeContactEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Compute the update payload when new name details arrive for an existing
 * contact. With overwriteNames (self-reported via RSVP or slot claim), any
 * provided value wins; without it (moderator invite capture), values only
 * fill fields that are currently empty. Returns only the fields to change.
 */
export function mergeContactNames(
  existing: ContactNameFields,
  incoming: IncomingContactNames,
  opts: { overwriteNames: boolean }
): Partial<{ first_name: string; last_name: string; role_note: string }> {
  const update: Partial<{ first_name: string; last_name: string; role_note: string }> = {}

  const apply = (
    key: 'first_name' | 'last_name' | 'role_note',
    incomingValue: string | null | undefined
  ) => {
    const value = incomingValue?.trim()
    if (!value) return
    const current = existing[key]
    if (opts.overwriteNames ? current !== value : !current) {
      update[key] = value
    }
  }

  apply('first_name', incoming.firstName)
  apply('last_name', incoming.lastName)
  apply('role_note', incoming.roleNote)
  return update
}

export function contactDisplayName(contact: {
  first_name: string | null
  last_name: string | null
  email: string
}): string {
  return (
    [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
    contact.email
  )
}

/** Display name for a profiles row: full name → first+last → email → fallback. */
export function profileDisplayName(
  profile: {
    full_name?: string | null
    first_name?: string | null
    last_name?: string | null
    email?: string | null
  } | null,
  fallback = 'Unknown'
): string {
  return (
    profile?.full_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    profile?.email ||
    fallback
  )
}
