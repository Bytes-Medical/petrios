import Link from 'next/link'
import { PublicNav } from '@/components/PublicNav'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Open Source',
  description:
    'Petrios is an AGPL-licensed, self-hostable teaching platform with an org-scoped REST API, signed webhooks, and portable teaching records. Run it on your own servers.',
  alternates: { canonical: '/open-source' },
}

const REPO = 'https://github.com/Bytes-Medical/bytes-teaching'

export default function OpenSourcePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav current="open-source" />
      <main className="flex-1 px-4 py-10 sm:py-14 bg-dotgrid">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="mb-4 text-center">
            <h1 className="font-mono text-3xl font-bold sm:text-4xl">
              Your servers. Your data. Your platform.
            </h1>
            <p className="mx-auto mt-3 max-w-2xl font-mono text-sm text-gray-700 leading-relaxed">
              Petrios is free software under AGPL-3.0. No procurement
              cycle, no per-seat licence, no lock-in — clone it, deploy it
              inside your trust, and keep all of your data where you
              can see it.
            </p>
          </div>

          <section className="border border-black border-t-4 border-t-clay-600 bg-white p-6 shadow-[8px_8px_0_rgba(31,29,26,0.08)] sm:p-8">
            <p className="font-mono text-xs uppercase tracking-wide text-clay-700">Self-hosting</p>
            <h2 className="mt-1 font-mono text-xl font-bold sm:text-2xl">
              Nothing has to leave your network
            </h2>
            <p className="mt-3 font-mono text-sm text-gray-700 leading-relaxed">
              Every external dependency has a self-hosted seat: your Postgres
              (via Supabase&apos;s self-host stack), your SMTP relay, your
              Jitsi server for video — and the AI layer speaks to any
              OpenAI-compatible endpoint, so it can run against an in-network
              model or be switched off entirely.
            </p>
            <div className="mt-4 overflow-x-auto border border-black bg-gray-50 p-4">
              <pre className="font-mono text-xs leading-relaxed">{`git clone ${REPO}.git
cd bytes-teaching
cp .env.example .env.production   # your DB, SMTP, domains
docker compose up -d --build
npm run db:migrate                # plain-Postgres migration runner
curl localhost:3000/api/health    # {"status":"ok","db":"ok"}`}</pre>
            </div>
            <p className="mt-3 font-mono text-sm">
              <a href={`${REPO}/blob/main/docs/self-hosting.md`} className="underline hover:text-clay-700">
                Read the self-hosting guide →
              </a>
            </p>
          </section>

          <section className="border border-black border-t-4 border-t-clay-600 bg-white p-6 shadow-[8px_8px_0_rgba(31,29,26,0.08)] sm:p-8">
            <p className="font-mono text-xs uppercase tracking-wide text-clay-700">Integrate</p>
            <h2 className="mt-1 font-mono text-xl font-bold sm:text-2xl">
              An API and webhooks, not an island
            </h2>
            <p className="mt-3 font-mono text-sm text-gray-700 leading-relaxed">
              Wire Petrios into rota systems, data warehouses, or your
              own frontends: an org-scoped REST API with scoped bearer tokens
              (OpenAPI schema included), plus HMAC-signed webhooks for session
              publishes, computed attendance, issued certificates, and claimed
              slots.
            </p>
            <ul className="mt-4 space-y-1.5 font-mono text-sm text-gray-700">
              <li><span className="text-clay-600">▸</span> Tokens created in Settings, hashed at rest, revocable, per-scope</li>
              <li><span className="text-clay-600">▸</span> <code>X-Petrios-Signature</code> on every webhook delivery</li>
              <li><span className="text-clay-600">▸</span> iCalendar feeds and CSV exports for everything tabular</li>
            </ul>
            <p className="mt-3 font-mono text-sm">
              <a href={`${REPO}/blob/main/docs/api.md`} className="underline hover:text-clay-700">
                API documentation →
              </a>
            </p>
          </section>

          <section className="border border-black border-t-4 border-t-clay-600 bg-white p-6 shadow-[8px_8px_0_rgba(31,29,26,0.08)] sm:p-8">
            <p className="font-mono text-xs uppercase tracking-wide text-clay-700">Federation</p>
            <h2 className="mt-1 font-mono text-xl font-bold sm:text-2xl">
              Records that survive rotation
            </h2>
            <p className="mt-3 font-mono text-sm text-gray-700 leading-relaxed">
              Trainees rotate; their teaching history shouldn&apos;t evaporate.
              Every instance can sign portable teaching records that any other
              instance — or anyone at all — can verify against the issuer&apos;s
              published key. Independent deployments become a network, not
              silos.
            </p>
            <p className="mt-3 font-mono text-sm">
              <Link href="/verify/record" className="underline hover:text-clay-700">
                Try the record verifier →
              </Link>
            </p>
          </section>

          <section className="border border-black border-t-4 border-t-clay-600 bg-white p-6 shadow-[8px_8px_0_rgba(31,29,26,0.08)] sm:p-8">
            <p className="font-mono text-xs uppercase tracking-wide text-clay-700">Trust &amp; governance</p>
            <h2 className="mt-1 font-mono text-xl font-bold sm:text-2xl">
              Built for the paperwork too
            </h2>
            <ul className="mt-3 space-y-1.5 font-mono text-sm text-gray-700">
              <li><span className="text-clay-600">▸</span> Row-level security everywhere; sensitive tables deny-all behind an audited service layer</li>
              <li><span className="text-clay-600">▸</span> CI security gates on every PR: CodeQL, Semgrep, secret scanning, dependency audit, an RLS guard</li>
              <li><span className="text-clay-600">▸</span> AI that drafts but never sends; prompt text never stored; one kill switch</li>
              <li>
                <span className="text-clay-600">▸</span> DTAC self-assessment starter and DPIA template in{' '}
                <a href={`${REPO}/tree/main/docs/compliance`} className="underline hover:text-clay-700">
                  docs/compliance
                </a>
              </li>
            </ul>
          </section>

          <div className="border border-black bg-white p-6 text-center shadow-[8px_8px_0_rgba(31,29,26,0.08)] sm:p-8">
            <h2 className="font-mono text-xl font-bold">Get involved</h2>
            <p className="mx-auto mt-2 max-w-xl font-mono text-sm text-gray-700">
              Star the repo, open an issue, pick something off the roadmap —
              or just tell us what your programme needs.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3 font-mono text-sm">
              <a href={REPO} className="border border-black bg-black px-4 py-2 text-white hover:bg-gray-800">
                Star on GitHub
              </a>
              <a href={`${REPO}/blob/main/ROADMAP.md`} className="border border-black bg-white px-4 py-2 hover:bg-gray-50">
                Roadmap
              </a>
              <Link href="/contributors" className="border border-black bg-white px-4 py-2 hover:bg-gray-50">
                Contributors
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
