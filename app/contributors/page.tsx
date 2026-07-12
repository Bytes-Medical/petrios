import Link from 'next/link'
import { Card } from '@/components/Card'
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

  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav current="contributors" />
      <main className="flex-1 px-4 py-10 sm:py-14 bg-dotgrid">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 text-center">
            <h1 className="font-mono text-3xl font-bold sm:text-4xl">Contributors</h1>
            <p className="mx-auto mt-3 max-w-2xl font-mono text-sm text-gray-700">
              Petrios is open source (AGPL-3.0) and built in the open.
              These are the people making it happen — code and beyond.
            </p>
            <p className="mt-3 font-mono text-xs text-gray-500">
              Want to join them? Read{' '}
              <a
                href={`https://github.com/${GITHUB_REPO}/blob/main/CONTRIBUTING.md`}
                className="underline hover:text-clay-700"
              >
                CONTRIBUTING.md
              </a>{' '}
              and pick something from the{' '}
              <a
                href={`https://github.com/${GITHUB_REPO}/blob/main/ROADMAP.md`}
                className="underline hover:text-clay-700"
              >
                roadmap
              </a>
              .
            </p>
          </div>

          <div className="space-y-6">
            <Card variant="raised">
              <h2 className="mb-4 font-mono text-xl font-bold">Team &amp; advisors</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CURATED_CONTRIBUTORS.map((person) => (
                  <div key={person.name} className="border border-black p-4">
                    <p className="font-mono text-sm font-bold">
                      {person.url ? (
                        <a href={person.url} className="underline hover:text-clay-700">
                          {person.name}
                        </a>
                      ) : (
                        person.name
                      )}
                    </p>
                    <p className="mt-1 font-mono text-xs uppercase tracking-wide text-clay-700">
                      {person.role}
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card variant="raised">
              <h2 className="mb-1 font-mono text-xl font-bold">Code contributors</h2>
              <p className="mb-4 font-mono text-xs text-gray-500">
                Pulled from the{' '}
                <a
                  href={`https://github.com/${GITHUB_REPO}/graphs/contributors`}
                  className="underline hover:text-clay-700"
                >
                  GitHub contributor graph
                </a>
                , refreshed hourly.
              </p>
              {githubContributors.length === 0 ? (
                <p className="border border-dashed border-gray-300 px-4 py-6 text-center font-mono text-sm text-gray-500">
                  Couldn&apos;t reach GitHub just now — see the{' '}
                  <a
                    href={`https://github.com/${GITHUB_REPO}/graphs/contributors`}
                    className="underline"
                  >
                    contributor graph
                  </a>{' '}
                  directly.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {githubContributors.map((contributor) => (
                    <a
                      key={contributor.login}
                      href={contributor.html_url}
                      className="flex items-center gap-2 border border-black bg-white px-3 py-2 transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_0_#1F1D1A]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- external avatar, unknown dimensions */}
                      <img
                        src={contributor.avatar_url}
                        alt=""
                        width={28}
                        height={28}
                        className="h-7 w-7 border border-black"
                      />
                      <span className="font-mono text-xs font-bold">{contributor.login}</span>
                      <span className="font-mono text-[10px] text-gray-500">
                        {contributor.contributions}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </Card>

            <div className="text-center">
              <Link href="/" className="font-mono text-sm underline hover:text-clay-700">
                ← Back to Petrios
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
