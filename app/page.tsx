import { getInstallationState } from '@/lib/db/installation'
import { redirect } from 'next/navigation'
import { IBM_Plex_Sans } from 'next/font/google'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { buttonVariants } from '@/components/Button'
import { Footer } from '@/components/Footer'
import { PublicNav } from '@/components/PublicNav'
import {
  HeroWorkflow,
  SchedulePreview,
  AttendancePreview,
  EvidencePreview,
  NewsletterPreview,
} from '@/components/landing/Previews'
import { INDIVIDUAL_SIGNUP_ENABLED } from '@/lib/flags'
import { NEWS } from '@/lib/news-data'
import {
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from '@/lib/site'
import styles from './landing.module.css'

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

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
      logo: `${SITE_URL}/opengraph-image`,
      sameAs: [GITHUB_URL],
    },
  ],
}

const audiences = [
  {
    number: '01',
    title: 'For organisers',
    body: 'Keep your programme moving with a clear view of the teaching ahead.',
    points: [
      'Shared scheduling and claimable slots',
      'Attendance oversight and audit reports',
    ],
  },
  {
    number: '02',
    title: 'For teachers',
    body: 'Make every teaching contribution part of your professional record.',
    points: [
      'Teaching certificates and feedback reports',
      'An appraisal-ready teaching dossier',
    ],
  },
  {
    number: '03',
    title: 'For trainees',
    body: 'Bring your learning and its evidence together as you progress.',
    points: [
      'Attendance, certificates, and reflections',
      'Verifiable portfolio packs',
    ],
  },
]

export default async function Home() {
  if (process.env.SELF_HOSTED_SETUP === 'true') {
    const state = await getInstallationState()
    if (!state.blocked && !state.completed_at) redirect('/setup')
  }
  const user = await getCurrentUser()
  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <PublicNav />
      <main className={`${plexSans.className} ${styles.landing}`}>
        <section
          className={`${styles.container} ${styles.hero}`}
          aria-labelledby="hero-title"
        >
          <div className={styles.heroCopy}>
            {NEWS[0] && (
              <Link
                className={styles.announcement}
                href={`/news#${NEWS[0].slug}`}
              >
                <span>What’s new</span>
                <span>{NEWS[0].title}</span>
                <span aria-hidden="true">↗</span>
              </Link>
            )}
            <p className={styles.eyebrow}>
              The operating system for clinical teaching
            </p>
            <h1 id="hero-title">
              Run your teaching programme <span>with less admin.</span>
            </h1>
            <p className={styles.heroDescription}>
              Plan sessions, coordinate teachers, review attendance, and bring
              feedback and certificates together.
            </p>
            <div className={styles.actions}>
              <Link
                className={buttonVariants({ size: 'lg' })}
                href="#how-it-works"
              >
                See how it works <span aria-hidden="true">↓</span>
              </Link>
              <a
                className={buttonVariants({ variant: 'secondary', size: 'lg' })}
                href={GITHUB_URL}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
                </svg>
                Star on GitHub
              </a>
              <Link className={styles.textLink} href="/join/dept">
                Join with a department code <span aria-hidden="true">↗</span>
              </Link>
            </div>
            {INDIVIDUAL_SIGNUP_ENABLED && (
              <Link className={styles.individualLink} href="/login/individual">
                Teach on your own →
              </Link>
            )}
            <ul className={styles.heroFacts} aria-label="Platform principles">
              <li>Open source</li>
              <li>Self-hostable</li>
              <li>Evidence-based</li>
            </ul>
          </div>
          <HeroWorkflow />
        </section>

        <section
          id="how-it-works"
          className={`${styles.container} ${styles.walkthrough}`}
          aria-labelledby="workflow-title"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>
              From the timetable to the portfolio
            </p>
            <h2 id="workflow-title">
              Good teaching has a lot of moving parts.
              <br />
              <span>Bring them together.</span>
            </h2>
          </div>
          <div className={styles.workflowRow}>
            <div className={styles.stepCopy}>
              <span className={styles.stepNumber}>01 / PLAN</span>
              <h3>Plan the programme.</h3>
              <p>
                Build the teaching week in one shared schedule. Publish open
                slots and let teachers claim the sessions they can lead.
              </p>
              <ul className={styles.featureList}>
                <li>Coordinate across departments</li>
                <li>Invite external teachers with an email link</li>
              </ul>
            </div>
            <SchedulePreview />
          </div>
          <div className={`${styles.workflowRow} ${styles.reverse}`}>
            <div className={styles.stepCopy}>
              <span className={styles.stepNumber}>02 / REVIEW</span>
              <h3>Review the session.</h3>
              <p>
                Bring check-ins and attendance evidence into one roster.
                Organisers review and finalize it, keeping a clear record of
                each decision.
              </p>
              <ul className={styles.featureList}>
                <li>Secure session codes and reviewed evidence</li>
                <li>Feedback collected separately from attendance</li>
              </ul>
            </div>
            <AttendancePreview />
          </div>
          <div className={styles.workflowRow}>
            <div className={styles.stepCopy}>
              <span className={styles.stepNumber}>03 / EVIDENCE</span>
              <h3>Bring the evidence together.</h3>
              <p>
                Turn the teaching you run into records people can use. Eligible
                certificates follow finalized attendance governance; feedback
                reports and reflections support professional development.
              </p>
              <ul className={styles.featureList}>
                <li>Verifiable certificates and portfolio packs</li>
                <li>Teaching contributions ready for appraisal</li>
              </ul>
            </div>
            <EvidencePreview />
          </div>
          <Link className={styles.textLink} href="/features">
            Explore all features <span aria-hidden="true">↗</span>
          </Link>
        </section>

        <section className={styles.aiBand} aria-labelledby="ai-title">
          <div className={`${styles.container} ${styles.aiGrid}`}>
            <div>
              <p className={styles.eyebrow}>
                A little help with the follow-through
              </p>
              <h2 id="ai-title">
                Useful drafts.
                <br />
                Human decisions.
              </h2>
              <p>
                Turn a week of teaching and its materials into a departmental
                newsletter. Review the draft, make it your own, and approve the
                version your colleagues receive.
              </p>
              <div className={styles.approvalNote}>
                <span aria-hidden="true">↳</span> AI-generated communications
                wait for human approval before sending.
              </div>
            </div>
            <NewsletterPreview />
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.audiences}`}
          aria-labelledby="people-title"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Everyone in the room</p>
            <h2 id="people-title">One programme. Shared progress.</h2>
          </div>
          <div className={styles.audienceGrid}>
            {audiences.map((audience) => (
              <article key={audience.number}>
                <span className={styles.stepNumber}>{audience.number}</span>
                <h3>{audience.title}</h3>
                <p>{audience.body}</p>
                <ul className={styles.featureList}>
                  {audience.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.ownership}`}
          aria-labelledby="ownership-title"
        >
          <div>
            <p className={styles.eyebrow}>Open by design</p>
            <h2 id="ownership-title">
              Your programme.
              <br />
              Your platform.
            </h2>
          </div>
          <div>
            <p>
              Petrios is open-source software under AGPL-3.0. Self-host it on
              your infrastructure, connect it to your systems, and keep teaching
              records portable and verifiable across instances.
            </p>
            <div className={styles.actions}>
              <Link className={styles.textLink} href="/open-source">
                Explore self-hosting <span aria-hidden="true">↗</span>
              </Link>
              <a className={styles.textLink} href={GITHUB_URL}>
                View on GitHub <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.closing}`}
          aria-labelledby="closing-title"
        >
          <p className={styles.eyebrow}>Make room for the teaching</p>
          <h2 id="closing-title">
            See what your next teaching
            <br className={styles.desktopBreak} /> week could look like.
          </h2>
          <div className={styles.actions}>
            <Link className={buttonVariants({ size: 'lg' })} href="/features">
              Explore Petrios <span aria-hidden="true">↗</span>
            </Link>
            <Link className={styles.textLink} href="/join/dept">
              Join your department <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
