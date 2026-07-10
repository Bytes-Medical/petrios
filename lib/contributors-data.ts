/**
 * Manually curated contributors — people whose contributions don't show in
 * the GitHub commit graph (clinical advisors, testers, designers, docs,
 * supervision). Edit this file to add someone; code contributors are pulled
 * automatically from the GitHub API on /contributors.
 */

export interface CuratedContributor {
  name: string
  role: string
  /** Optional link (GitHub profile, website, ORCID…). */
  url?: string
}

export const CURATED_CONTRIBUTORS: CuratedContributor[] = [
  {
    name: 'Akanimoh Osutuk',
    role: 'Creator & maintainer',
    url: 'https://github.com/FibrinLab',
  },
  // Add contributors here, e.g.:
  // { name: 'Dr A. Example', role: 'Clinical education advisor' },
]

/** The public repository backing the contributor graph and issue links. */
export const GITHUB_REPO = 'Bytes-Medical/bytes-teaching'
