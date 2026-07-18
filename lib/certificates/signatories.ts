/**
 * The people shown on a certificate: the department's ordered teaching
 * coordinators (snapshotted to `certificates.coordinator_names`) and the
 * moderator who actually generated it (`certificates.issued_by_name`).
 *
 * A coordinator who also issued the certificate is shown only once. Shared by
 * public verification and the PDF so the two surfaces cannot disagree.
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

export function buildSignatories(input: {
  coordinatorNames?: string[] | null
  issuerName?: string | null
}): Signatory[] {
  const coordinators = (input.coordinatorNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
  const issuer = input.issuerName?.trim() || ''
  const rows = coordinators.map((value) => ({
    label: 'Teaching coordinator',
    value,
  }))

  if (issuer && !coordinators.some((name) => norm(name) === norm(issuer))) {
    rows.push({ label: 'Issued by', value: issuer })
  }

  return rows
}
