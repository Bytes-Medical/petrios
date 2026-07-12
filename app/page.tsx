import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { Button } from '@/components/Button'
import { Typewriter } from '@/components/Typewriter'
import { Footer } from '@/components/Footer'
import { PublicNav } from '@/components/PublicNav'
import Image from 'next/image'
import Link from 'next/link'
import { INDIVIDUAL_SIGNUP_ENABLED } from '@/lib/flags'
import { NEWS } from '@/lib/news-data'
import { GITHUB_URL, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site'

export const metadata = {
  title: { absolute: `${SITE_NAME} — ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
}

// Structured data: helps Google show the project as software with rich
// results. Values are all our own constants — nothing user-supplied.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web',
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
      sameAs: [GITHUB_URL],
    },
    {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/assets/byte_logo.png`,
      sameAs: [GITHUB_URL],
    },
  ],
}

const AUDIENCES = [
  {
    initial: 'T',
    title: 'For trainees',
    lead: 'Turn up, and the evidence takes care of itself.',
    body: 'Attendance is recorded the moment you scan, join the video room, or give feedback. Your curriculum passport shows which Progress+ domains you’ve covered, and a verifiable portfolio pack is one click when ARCP season arrives. Missed a session? Pass three recall questions and catch up — honestly labelled.',
  },
  {
    initial: 'F',
    title: 'For teachers & faculty',
    lead: 'Teaching should count for you too.',
    body: 'Claim a teaching slot in one click — no account needed if you’re external. Feedback comes back anonymised with themes, certificates are automatic, and every session you teach builds an appraisal-ready dossier: sessions, hours, reach, and what attendees actually said.',
  },
  {
    initial: 'O',
    title: 'For organisers',
    lead: 'Run the programme, not the inbox.',
    body: 'Publish availability and let teachers claim it. An AI assistant drafts your speaker chases, thank-yous, and weekly digest — nothing sends until you approve it. Audit, equity, and curriculum coverage dashboards make the DME report write itself.',
  },
]

const CONTRASTS = [
  {
    old: 'Sign-in sheets and box-ticking',
    oldDetail: 'A register that proves someone held a pen.',
    now: 'Evidence-based attendance',
    nowDetail: 'Check-ins, video joins, and feedback feed one audited, lockable record.',
  },
  {
    old: 'Records trapped in one trust',
    oldDetail: 'Rotate hospitals and your history evaporates.',
    now: 'Records that travel',
    nowDetail: 'Signed, portable teaching records any instance can verify.',
  },
  {
    old: 'Per-seat licences and lock-in',
    oldDetail: 'Your data lives on someone else’s terms.',
    now: 'Open source, your servers',
    nowDetail: 'AGPL-3.0. Self-host everything — database, email, video, even the AI.',
  },
  {
    old: 'Admin by inbox-chasing',
    oldDetail: 'Who’s teaching Thursday? Did anyone reply?',
    now: 'AI drafts, humans approve',
    nowDetail: 'The assistant writes the chasing; every email waits for your sign-off.',
  },
]

const STEPS = [
  {
    step: '01',
    title: 'Join',
    body: 'One 6-digit department code for trainees. External teachers need no account at all — email links do the work.',
  },
  {
    step: '02',
    title: 'Teach',
    body: 'Schedule sessions or publish claimable slots. Built-in video, QR feedback, automatic reminders and certificates.',
  },
  {
    step: '03',
    title: 'Evidence',
    body: 'Attendance, coverage, reflections, and feedback compound into portfolio packs, dossiers, and audit reports — automatically.',
  },
]

export default async function Home() {
  const user = await getCurrentUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <PublicNav />
      <main className="flex-1 px-4 py-12 sm:py-16 bg-dotgrid">
        <div className="mx-auto max-w-4xl w-full space-y-8 sm:space-y-10">
          {/* Announcement strip: always the newest entry in lib/news-data.ts */}
          {NEWS[0] && (
            <Link
              href={`/news#${NEWS[0].slug}`}
              className="flex items-center justify-center gap-2 border border-black bg-white px-4 py-2.5 font-mono text-xs sm:text-sm transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_0_#1F1D1A]"
            >
              <span className="border border-clay-600 bg-clay-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                {NEWS[0].tag}
              </span>
              <span className="min-w-0 truncate">{NEWS[0].title}</span>
              <span className="shrink-0 text-clay-700">→</span>
            </Link>
          )}
          <div className="border border-black border-t-4 border-t-clay-600 p-8 sm:p-12 bg-white shadow-[8px_8px_0_rgba(31,29,26,0.08)]">
            {/* Hero */}
            <div className="text-center mb-8 sm:mb-12">
              <div className="flex justify-center mb-6">
                <Image
                  src="/assets/byte_logo.png"
                  alt="Byte Teaching Logo"
                  width={300}
                  height={200}
                  className="w-auto h-auto max-w-full mix-blend-multiply"
                  priority
                />
              </div>
              <h1 className="h-8 sm:h-10 mb-6 font-normal">
                <Typewriter
                  text="The operating system for clinical teaching"
                  speed={30}
                  className="text-xl sm:text-2xl md:text-3xl font-mono text-gray-800"
                />
              </h1>
              <p className="font-mono text-sm sm:text-base text-gray-700 max-w-2xl mx-auto leading-relaxed">
                A learning platform stores course content. Byte Teaching runs
                the live teaching around it — scheduling, attendance evidence,
                feedback, video, certificates, and the admin in between
                {INDIVIDUAL_SIGNUP_ENABLED
                  ? ' — whether you teach on your own or run a whole programme.'
                  : ', across your trust or teaching programme.'}
              </p>
              <p className="mt-4 font-mono text-sm text-gray-600">
                Evidence-based<span className="text-clay-600"> ▪ </span>
                Self-hostable<span className="text-clay-600"> ▪ </span>
                Yours, by design
              </p>
            </div>

            {/* Sign-in paths */}
            <div
              className={`grid grid-cols-1 gap-4 sm:gap-6 ${
                INDIVIDUAL_SIGNUP_ENABLED ? 'sm:grid-cols-2' : 'max-w-md mx-auto'
              }`}
            >
              {/* Individual */}
              {INDIVIDUAL_SIGNUP_ENABLED && (
                <div className="flex flex-col border border-black p-6 bg-white transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_0_#1F1D1A]">
                  <span className="mb-2 font-mono text-xs uppercase tracking-wide text-clay-700">
                    Individual
                  </span>
                  <h2 className="mb-3 text-lg sm:text-xl font-mono font-bold">
                    Teach on your own
                  </h2>
                  <p className="mb-6 flex-1 font-mono text-sm text-gray-700 leading-relaxed">
                    Run your own sessions in minutes. QR attendance, automatic
                    certificates, and feedback reports — no organisation required. We set
                    up your personal teaching space the moment you sign in.
                  </p>
                  <Link href="/login/individual">
                    <Button className="w-full">Start teaching →</Button>
                  </Link>
                </div>
              )}

              {/* Organisation */}
              <div className="flex flex-col border border-black p-6 bg-white transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_0_#1F1D1A]">
                <span className="mb-2 font-mono text-xs uppercase tracking-wide text-clay-700">
                  Organisation
                </span>
                <h2 className="mb-3 text-lg sm:text-xl font-mono font-bold">
                  For trusts &amp; programmes
                </h2>
                <p className="mb-6 flex-1 font-mono text-sm text-gray-700 leading-relaxed">
                  Coordinate teaching across departments with shared scheduling, audit
                  reports, member management, and oversight. Join your programme with
                  the code your teaching lead gave you.
                </p>
                <div className="flex flex-col gap-3">
                  <Link href="/login/organisation">
                    <Button className="w-full">Sign in</Button>
                  </Link>
                  <Link href="/join/dept">
                    <Button variant="secondary" className="w-full">
                      Join with a department code
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Everyone in the room */}
          <section className="border border-black border-t-4 border-t-clay-600 bg-white p-6 sm:p-8 shadow-[8px_8px_0_rgba(31,29,26,0.08)]">
            <h2 className="mb-6 text-center font-mono text-xl sm:text-2xl font-bold">
              Built for everyone in the room
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {AUDIENCES.map((audience) => (
                <div key={audience.title} className="border border-black p-5">
                  <span className="flex h-8 w-8 items-center justify-center border border-black bg-clay-600 font-mono text-sm font-bold text-white">
                    {audience.initial}
                  </span>
                  <h3 className="mt-3 font-mono text-base font-bold">{audience.title}</h3>
                  <p className="mt-1 font-mono text-sm font-bold text-clay-700">
                    {audience.lead}
                  </p>
                  <p className="mt-2 font-mono text-xs text-gray-700 leading-relaxed">
                    {audience.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Old way / new way */}
          <section className="border border-black border-t-4 border-t-clay-600 bg-white p-6 sm:p-8 shadow-[8px_8px_0_rgba(31,29,26,0.08)]">
            <h2 className="text-center font-mono text-xl sm:text-2xl font-bold">
              A different shape of system
            </h2>
            <p className="mx-auto mt-2 mb-6 max-w-xl text-center font-mono text-sm text-gray-600">
              Why teaching programmes outgrow spreadsheets, sign-in sheets,
              and content platforms.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-3 font-mono text-xs uppercase tracking-wide text-gray-500">
                  The usual way
                </p>
                <div className="space-y-3">
                  {CONTRASTS.map((row) => (
                    <div key={row.old} className="border border-gray-300 bg-gray-50 p-4">
                      <p className="font-mono text-sm font-bold text-gray-600">{row.old}</p>
                      <p className="mt-1 font-mono text-xs text-gray-500">{row.oldDetail}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 font-mono text-xs uppercase tracking-wide text-clay-700">
                  The Byte Teaching way
                </p>
                <div className="space-y-3">
                  {CONTRASTS.map((row) => (
                    <div key={row.now} className="border border-black p-4">
                      <p className="font-mono text-sm font-bold">{row.now}</p>
                      <p className="mt-1 font-mono text-xs text-gray-700">{row.nowDetail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* How it works */}
          <section className="border border-black border-t-4 border-t-clay-600 bg-white p-6 sm:p-8 shadow-[8px_8px_0_rgba(31,29,26,0.08)]">
            <h2 className="mb-6 text-center font-mono text-xl sm:text-2xl font-bold">
              How it works
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {STEPS.map((item) => (
                <div key={item.step} className="border border-black p-5">
                  <p className="font-mono text-2xl font-bold text-clay-600">{item.step}</p>
                  <h3 className="mt-2 font-mono text-base font-bold">{item.title}</h3>
                  <p className="mt-2 font-mono text-xs text-gray-700 leading-relaxed">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center font-mono text-sm">
              <Link href="/features" className="underline hover:text-clay-700">
                Explore all features →
              </Link>
            </p>
          </section>

          {/* Open source */}
          <section className="border border-black border-t-4 border-t-clay-600 bg-white p-6 sm:p-8 shadow-[8px_8px_0_rgba(31,29,26,0.08)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="mb-2 text-base sm:text-lg font-mono font-bold">
                  Open source. Your servers. Your data.
                </h2>
                <p className="font-mono text-sm text-gray-700 leading-relaxed max-w-xl">
                  Byte Teaching is free software (AGPL-3.0). Self-host the whole
                  platform inside your trust — your own database, mail relay, video
                  server, even an in-network AI model — and integrate anything through
                  the org-scoped REST API and signed webhooks. Teaching records are
                  portable and verifiable across instances, so a trainee&apos;s history
                  survives every rotation.
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 font-mono text-sm">
                <a
                  href="https://github.com/Bytes-Medical/bytes-teaching"
                  className="border border-black bg-black px-4 py-2 text-center text-white hover:bg-gray-800"
                >
                  Star on GitHub
                </a>
                <Link
                  href="/open-source"
                  className="border border-black bg-white px-4 py-2 text-center hover:bg-gray-50"
                >
                  Self-host it
                </Link>
                <Link
                  href="/contributors"
                  className="border border-black bg-white px-4 py-2 text-center hover:bg-gray-50"
                >
                  Contributors
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}
