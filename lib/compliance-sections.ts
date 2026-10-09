/**
 * Anchor ids for compliance-page sections. The `section-…` format predates
 * the public-site redesign and is kept so existing links keep resolving; the
 * legal pages build their "On this page" contents from the same function.
 */
export function complianceSectionId(title: string): string {
  return `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}
