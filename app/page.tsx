import { getInstallationState } from '@/lib/db/installation'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { getCurrentUser } from '@/lib/auth'
import { AnnouncementBar } from '@/components/hud/AnnouncementBar'
import { AudienceCards, type Audience } from '@/components/hud/AudienceCards'
import { CalibrationStrip } from '@/components/hud/CalibrationStrip'
import { CompareRows, type Contrast } from '@/components/hud/CompareRows'
import { HudLink } from '@/components/hud/HudLink'
import { HudShell } from '@/components/hud/HudShell'
import { Panel } from '@/components/hud/Panel'
import { SectionHeading } from '@/components/hud/SectionHeading'
import { SequenceSteps, type SequenceStep } from '@/components/hud/SequenceSteps'
import s from '@/components/hud/hud.module.css'
import { INDIVIDUAL_SIGNUP_ENABLED } from '@/lib/flags'
import { NEWS } from '@/lib/news-data'
import {
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from '@/lib/site'

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

const AUDIENCES: ReadonlyArray<Audience> = [
  {
    initial: 'T',
    title: 'For trainees',
    lead: 'Turn up, and the evidence takes care of itself.',
    body: 'Check in with your account or the secure session code; organisers review and finalize a complete attendance roster. Your progress view brings attendance, reflections, certificates, and a verifiable portfolio pack together. Recall quizzes support learning after a missed session without rewriting physical attendance.',
  },
  {
    initial: 'F',
    title: 'For teachers & faculty',
    lead: 'Teaching should count for you too.',
    body: 'Claim a teaching slot in one click — no account needed if you’re external. Teacher reports contain privacy-safe aggregate feedback, teaching certificates follow accepted assignments and finalized session governance, and every session you teach builds an appraisal-ready dossier: sessions, hours, reach, and improvement themes.',
  },
  {
    initial: 'O',
    title: 'For organisers',
    lead: 'Run the programme, not the inbox.',
    body: 'Publish availability and let teachers claim it. AI drafts speaker chases and thank-yous, while moderators can turn a full week of teaching and its materials into a polished departmental newsletter. Nothing sends until a human reviews and approves it.',
  },
]

const CONTRASTS: ReadonlyArray<Contrast> = [
  {
    usual: 'Sign-in sheets and box-ticking',
    usualDetail: 'A register that proves someone held a pen.',
    better: 'Evidence-based attendance',
    betterDetail: 'Check-ins and reviewed evidence feed one revisioned, finalized roster.',
  },
  {
    usual: 'Records trapped in one trust',
    usualDetail: 'Rotate hospitals and your history evaporates.',
    better: 'Records that travel',
    betterDetail: 'Signed, portable teaching records any instance can verify.',
  },
  {
    usual: 'Per-seat licences and lock-in',
    usualDetail: 'Your data lives on someone else’s terms.',
    better: 'Open source, your servers',
    betterDetail: 'AGPL-3.0. Self-host everything — database, email, video, even the AI.',
  },
  {
    usual: 'Admin by inbox-chasing',
    usualDetail: 'Who’s teaching Thursday? Did anyone reply?',
    better: 'AI drafts, humans approve',
    betterDetail: 'The assistant writes the chasing; every email waits for your sign-off.',
  },
]

// Readouts are verified product facts only; `source` is for reviewers and
// must change with the constant it cites.
const STEPS: ReadonlyArray<SequenceStep> = [
  {
    title: 'Join',
    body: 'One 6-digit department code for trainees. External teachers need no account at all — email links do the work.',
    readout: {
      label: 'Department code',
      value: 6,
      unit: 'digits',
      source: 'app/join/dept/JoinByDeptCodeForm.tsx maxLength={6}',
    },
  },
  {
    title: 'Teach',
    body: 'Schedule sessions or publish claimable slots. Built-in video, QR feedback, private documents, automatic reminders, and certificates after attendance finalization.',
    readout: {
      label: 'Session documents',
      value: 25,
      unit: 'MiB per file',
      source: 'lib/session-documents.ts SESSION_DOCUMENT_MAX_BYTES',
    },
  },
  {
    title: 'Evidence',
    body: 'Attendance records, reflections, certificates, and feedback compound into portfolio packs, dossiers, and audit reports — automatically.',
    readout: {
      label: 'Portfolio packs',
      value: 'Verifiable by code',
      source: 'spec/08 portfolio packs, /verify/pack/[code]',
    },
  },
]

function Door({
  label,
  title,
  body,
  children,
}: {
  label: string
  title: string
  body: string
  children: ReactNode
}) {
  return (
    <div className={s.door}>
      <p className={s.doorLabel}>{label}</p>
      <h2 className={s.doorTitle}>{title}</h2>
      <p className={s.doorBody}>{body}</p>
      <div className={s.doorActions}>{children}</div>
    </div>
  )
}

export default async function Home() {
  if (process.env.SELF_HOSTED_SETUP === 'true') {
    const state = await getInstallationState()
    if (!state.blocked && !state.completed_at) redirect('/setup')
  }
  const user = await getCurrentUser()
  if (user) redirect('/dashboard')

  const announcement = NEWS[0]

  return (
    <HudShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      {announcement ? <AnnouncementBar entry={announcement} /> : null}

      <Panel as="section" pad="none" aria-labelledby="hero-title" className={s.hero}>
        <CalibrationStrip />
        <div className={s.heroBody}>
          <p className={s.heroLede}>
            A learning platform stores course content. Petrios runs the live
            teaching around it — scheduling, attendance evidence, feedback,
            video, certificates, and the admin in between
            {INDIVIDUAL_SIGNUP_ENABLED
              ? ' — whether you teach on your own or run a whole programme.'
              : ', across your trust or teaching programme.'}
          </p>
          <ul className={s.facts} aria-label="Principles">
            <li>Evidence-based</li>
            <li>Self-hostable</li>
            <li>Yours, by design</li>
          </ul>
          <div className={clsx(s.doors, INDIVIDUAL_SIGNUP_ENABLED && s.doorsTwo)}>
            {INDIVIDUAL_SIGNUP_ENABLED ? (
              <Door
                label="Individual"
                title="Teach on your own"
                body="Run your own sessions in minutes. QR attendance, automatic certificates, and feedback reports — no organisation required. We set up your personal teaching space the moment you sign in."
              >
                <HudLink href="/login/individual" variant="primary" block>
                  Start teaching
                </HudLink>
              </Door>
            ) : null}
            <Door
              label="Organisation"
              title="For trusts & programmes"
              body="Coordinate teaching across departments with shared scheduling, audit reports, member management, and oversight. Join your programme with the 6-digit code your teaching lead gave you."
            >
              <HudLink href="/login/organisation" variant="primary" block>
                Sign in
              </HudLink>
              <HudLink href="/join/dept" variant="secondary" block>
                Join with a department code
              </HudLink>
            </Door>
          </div>
        </div>
      </Panel>

      <Panel aria-labelledby="audiences-title">
        <SectionHeading id="audiences-title" title="Built for everyone in the room" />
        <AudienceCards items={AUDIENCES} />
      </Panel>

      <Panel aria-labelledby="shape-title">
        <SectionHeading
          id="shape-title"
          title="A different shape of system"
          lede="Why teaching programmes outgrow spreadsheets, sign-in sheets, and content platforms."
        />
        <CompareRows rows={CONTRASTS} />
      </Panel>

      <Panel aria-labelledby="how-title">
        <SectionHeading id="how-title" title="How it works" />
        <SequenceSteps items={STEPS} />
        <p className={s.panelLinkRow}>
          <HudLink href="/features">Explore all features</HudLink>
        </p>
      </Panel>

      <Panel aria-labelledby="oss-title" bodyClassName={s.ossGrid}>
        <div>
          <h2 id="oss-title" className={clsx(s.sectionTitle, s.ossTitle)}>
            Open source. Your servers. Your data.
          </h2>
          <p className={s.ossBody}>
            Petrios is free software (AGPL-3.0). Self-host the whole platform
            inside your trust — your own database, mail relay, video server,
            even an in-network AI model — and integrate anything through the
            org-scoped REST API and signed webhooks. Teaching records are
            portable and verifiable across instances, so a trainee’s
            history survives every rotation.
          </p>
        </div>
        <div className={s.ctaStack}>
          <HudLink href={GITHUB_URL} variant="ink" block>
            Star on GitHub
          </HudLink>
          <HudLink href="/open-source" variant="secondary" block>
            Self-host it
          </HudLink>
          <HudLink href="/contributors" variant="secondary" block>
            Contributors
          </HudLink>
        </div>
      </Panel>
    </HudShell>
  )
}
