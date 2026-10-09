import { HudShell } from '@/components/hud/HudShell'
import { HudLink } from '@/components/hud/HudLink'
import { Ledger } from '@/components/hud/Ledger'
import { PageHeader } from '@/components/hud/PageHeader'
import { CURATED_CONTRIBUTORS, GITHUB_REPO } from '@/lib/contributors-data'

export const revalidate = 3600 // refresh the GitHub contributor graph hourly

export const metadata = {
  title: 'Contributors',
  description:
    'The people building Petrios — founder, clinical advisors, and open-source code contributors.',
  alternates: { canonical: '/contributors' },
}

interface GithubContributor {
  login: string
  avatar_url: string
  html_url: string
  contributions: number
  type: string
}

/**
 * PUBLIC contributors page (listed in proxy.ts). Two sources:
 *   1. Code contributors — fetched live from the GitHub API (cached 1h).
 *   2. Curated contributors — lib/contributors-data.ts, hand-edited for
 *      people whose work doesn't show in the commit graph.
 */
async function fetchGithubContributors(): Promise<GithubContributor[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contributors?per_page=100`,
      { headers: { Accept: 'application/vnd.github+json' }, next: { revalidate: 3600 } }
    )
    if (!response.ok) return []
    const contributors = (await response.json()) as GithubContributor[]
    return contributors.filter((c) => c.type !== 'Bot')
  } catch {
    return []
  }
}

export default async function ContributorsPage() {
  const githubContributors = await fetchGithubContributors()
  const curatedProfileUrls = new Set(
    CURATED_CONTRIBUTORS.flatMap((person) =>
      person.url ? [person.url.replace(/\/$/, '').toLowerCase()] : []
    )
  )
  const codeContributors = githubContributors.filter(
    (contributor) =>
      !curatedProfileUrls.has(contributor.html_url.replace(/\/$/, '').toLowerCase())
  )
  const people = [
    ...CURATED_CONTRIBUTORS.map((person) => ({
      name: person.name,
      detail: person.role,
      url: person.url,
    })),
    ...codeContributors.map((contributor) => ({
      name: `@${contributor.login}`,
      detail: `Code contributor · ${contributor.contributions} contribution${
        contributor.contributions === 1 ? '' : 's'
      }`,
      url: contributor.html_url,
    })),
  ]
  const githubListAvailable = githubContributors.length > 0

  return (
    <HudShell current="contributors" width="prose">
      <PageHeader
        title="Contributors"
        lede="Built with care, in the open, by people who believe clinical teaching deserves thoughtful tools."
      />

      <Ledger
        title="The people behind Petrios"
        people={people}
        githubList={githubListAvailable ? 'cached' : 'unavailable'}
        footer={
          githubListAvailable ? (
            <>
              Want to add your name? Read{' '}
              <HudLink href={`https://github.com/${GITHUB_REPO}/blob/main/CONTRIBUTING.md`}>
                CONTRIBUTING.md
              </HudLink>{' '}
              or find a place to help on the{' '}
              <HudLink href={`https://github.com/${GITHUB_REPO}/blob/main/ROADMAP.md`}>roadmap</HudLink>.
            </>
          ) : (
            <>
              The GitHub list is unavailable just now. View the{' '}
              <HudLink href={`https://github.com/${GITHUB_REPO}/graphs/contributors`}>
                contributor graph
              </HudLink>
              .
            </>
          )
        }
      />
    </HudShell>
  )
}
