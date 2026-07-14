import Link from 'next/link'
import { Footer } from '@/components/Footer'
import { PublicNav } from '@/components/PublicNav'
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

  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav current="contributors" />
      <main className="flex-1 px-4 py-10 sm:py-14 bg-dotgrid">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 text-center sm:mb-10">
            <h1 className="font-mono text-3xl font-bold sm:text-4xl">Contributors</h1>
            <p className="mx-auto mt-3 max-w-2xl font-mono text-sm text-gray-700">
              Built with care, in the open, by people who believe clinical
              teaching deserves thoughtful tools.
            </p>
          </div>

          <div className="overflow-hidden border border-black border-t-4 border-t-clay-600 bg-white shadow-[8px_8px_0_rgba(31,29,26,0.08)]">
            <div className="border-b border-black px-5 py-4 sm:px-7">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-clay-700">
                The people behind Petrios
              </p>
            </div>

            <ol className="divide-y divide-gray-200">
              {people.map((person, index) => {
                const content = (
                  <>
                    <span className="w-8 shrink-0 font-mono text-xs text-clay-700">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm font-bold text-black">
                        {person.name}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-gray-600">
                        {person.detail}
                      </span>
                    </span>
                    {person.url ? (
                      <span aria-hidden="true" className="shrink-0 font-mono text-sm text-gray-400">
                        ↗
                      </span>
                    ) : null}
                  </>
                )

                return (
                  <li key={`${person.name}-${person.detail}`}>
                    {person.url ? (
                      <a
                        href={person.url}
                        className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-clay-50 sm:px-7 sm:py-5"
                      >
                        {content}
                      </a>
                    ) : (
                      <div className="flex items-center gap-3 px-5 py-4 sm:px-7 sm:py-5">
                        {content}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>

            <div className="border-t border-black bg-clay-50 px-5 py-4 font-mono text-xs leading-relaxed text-gray-700 sm:px-7">
              {githubContributors.length === 0 ? (
                <>
                  The GitHub list is unavailable just now. View the{' '}
                  <a
                    href={`https://github.com/${GITHUB_REPO}/graphs/contributors`}
                    className="underline hover:text-clay-700"
                  >
                    contributor graph
                  </a>
                  .
                </>
              ) : (
                <>
                  Want to add your name? Read{' '}
                  <a
                    href={`https://github.com/${GITHUB_REPO}/blob/main/CONTRIBUTING.md`}
                    className="underline hover:text-clay-700"
                  >
                    CONTRIBUTING.md
                  </a>{' '}
                  or find a place to help on the{' '}
                  <a
                    href={`https://github.com/${GITHUB_REPO}/blob/main/ROADMAP.md`}
                    className="underline hover:text-clay-700"
                  >
                    roadmap
                  </a>
                  .
                </>
              )}
            </div>

          </div>

          <div className="mt-8 text-center">
            <Link href="/" className="font-mono text-sm underline hover:text-clay-700">
              ← Back to Petrios
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
