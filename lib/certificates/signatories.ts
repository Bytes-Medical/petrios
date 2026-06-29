/**
 * The people who vouch for a certificate: the department's standing Teaching
 * Lead (`departments.lead_name`) and the moderator who actually generated it
 * (`certificates.issued_by_name`).
 *
 * These are frequently the same person, so this collapses them into a single
 * "Certified by" line when they match, and only shows both when they differ.
 * Shared by the public verify page and the PDF so the two never disagree.
 */

export interface Signatory {
  label: string
  value: string
}

/** Normalise a name for comparison: trim, lowercase, collapse inner whitespace. */
function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function buildSignatories(
  leadName?: string | null,
  issuerName?: string | null
): Signatory[] {
  const lead = leadName?.trim() || ''
  const issuer = issuerName?.trim() || ''

  if (lead && issuer) {
    // Same person wearing both hats — one line, not two.
    if (norm(lead) === norm(issuer)) {
      return [{ label: 'Certified by', value: lead }]
    }
    return [
      { label: 'Teaching Lead', value: lead },
      { label: 'Issued by', value: issuer },
    ]
  }
  if (lead) return [{ label: 'Teaching Lead', value: lead }]
  if (issuer) return [{ label: 'Issued by', value: issuer }]
  return []
}
