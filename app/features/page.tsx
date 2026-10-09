import { clsx } from 'clsx'
import { HudShell } from '@/components/hud/HudShell'
import { HudLink } from '@/components/hud/HudLink'
import { OnThisPage } from '@/components/hud/OnThisPage'
import { PageHeader } from '@/components/hud/PageHeader'
import { Panel, PanelTitle } from '@/components/hud/Panel'
import { SpecStrip, type SpecItem } from '@/components/hud/Readout'
import s from '@/components/hud/hud.module.css'

export const metadata = {
  title: 'Features',
  description:
    'Everything a clinical teaching programme runs on with Petrios: evidence-based attendance, built-in video, claimable slots, AI with human approval, and portfolio-ready evidence.',
  alternates: { canonical: '/features' },
}

interface Feature {
  id: string
  label: string
  title: string
  body: string
  points: string[]
  spec: SpecItem[]
}

const FEATURES: Feature[] = [
  {
    id: 'attendance',
    label: 'Attendance',
    title: 'Evidence, not box-ticking',
    body: 'Attendance is computed from append-only evidence — moderator confirmation, reviewed integrations, secure group codes, and self check-in. Organisers finalize a complete roster into a numbered revision; corrections require a reason and a new revision. Feedback, teacher assignment, and Recall never masquerade as physical attendance.',
    points: [
      'Random, salted, rate-limited group codes for low-friction check-in',
      'Joining the built-in video room attempts the same windowed self check-in',
      'Missing evidence becomes an explicit absence when the roster is finalized',
      'Append-only evidence, reasoned corrections, numbered revisions, and safe CSV export',
    ],
    spec: [
      { label: 'Roster', value: 'Numbered revisions', source: 'spec/03; CLAUDE.md "Evidence-Based Attendance"' },
      { label: 'Corrections', value: 'Reason required', source: 'spec/03 (reopening requires a reason)' },
      { label: 'Evidence', value: 'Append-only', source: 'spec/03; attendance_evidence is append-only' },
    ],
  },
  {
    id: 'petrios-meet',
    label: 'Petrios Meet',
    title: 'Video built in, not bolted on',
    body: 'Give any session a video room with zero setup — no links to paste, ever. Rooms are generated per session, embedded in the session page for members, and joinable by external guests with a plain link. Swap the backend for your own Jitsi server with one environment variable.',
    points: [
      'Auto-generated rooms on Jitsi (self-hostable)',
      'Embedded joining attempts windowed self check-in',
      'Microsoft Teams links equally supported for Teams-first trusts',
    ],
    spec: [
      { label: 'Rooms', value: 'One per session', source: 'lib/jitsi.ts (room derived from the session id)' },
      { label: 'Video server', value: 'Jitsi, self-hostable', source: 'NEXT_PUBLIC_JITSI_DOMAIN' },
      { label: 'Joining', value: 'Attempts self check-in', source: 'components/JitsiMeetingPanel.tsx fires checkIn' },
    ],
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    title: 'Claimable teaching slots',
    body: 'Publish your programme’s empty slots Calendly-style — to contact groups from the address book, to all registered members, or both. First to claim gets the slot, atomically; a draft session is created with the claimer attached as an accepted teacher, and you assign the topic later.',
    points: [
      'External teachers claim via email links — no account needed',
      'Teacher invitations with accept/decline and automatic 24h reminders',
      'Open slots render as “Available” on the shared calendar (ICS feed included)',
    ],
    spec: [
      { label: 'Claims', value: 'First come, first served', source: 'lib/db/teaching-slots.ts (atomic CAS)' },
      { label: 'Lightning slots', value: '10, 15 or 20 min', source: 'lib/slot-schedule.ts SLOT_SPLIT_OPTIONS' },
      { label: 'Reminders', value: 'About 24 h before', source: 'app/api/cron/session-reminders (~24h)' },
    ],
  },
  {
    id: 'feedback',
    label: 'Feedback',
    title: 'Accountless feedback, safely summarised',
    body: 'Attendees scan a QR and answer your department’s custom form without needing an account. Submissions are identified, limited to the server-enforced window, and never create attendance or certificates. Moderators can request privacy-processed AI themes from the first response; teacher release omits identities and raw comments and labels small cohorts as limited evidence.',
    points: [
      'Custom per-department forms with 1–5 scored questions',
      'Live stats, safety-screened AI summaries, privacy-safe teacher reports',
      'Low-scoring sessions alert moderators automatically',
    ],
    spec: [
      {
        label: 'Responses',
        value: 'One per person per session',
        source: 'CLAUDE.md Feedback (one response per normalized email/session)',
      },
      { label: 'Scored questions', value: '1–5 scale', source: 'Feature copy; per-department feedback forms' },
      {
        label: 'Small cohorts',
        value: 'Under 5 responses flagged',
        source: 'spec/05; CLAUDE.md Feedback (limited-evidence warning below five responses)',
      },
    ],
  },
  {
    id: 'evidence-engine',
    label: 'Evidence Engine',
    title: 'Portfolio-ready proof, one click',
    body: 'Trainees get a clear attendance record, per-session reflections, certificates, and a verifiable ARCP portfolio pack. Teachers get an appraisal-ready dossier: sessions taught, hours, reach, and privacy-processed feedback themes without stored identity fields.',
    points: [
      'Portfolio packs are snapshotted and publicly verifiable by code',
      'Signed, portable teaching records survive rotating between trusts',
      'Five-minute, document-led audio recaps add moderator-reviewed authoritative context',
      'Audio Recap catch-up turns an approved recap and 5/5 mastery into transparent attendance evidence',
    ],
    spec: [
      { label: 'Audio recap', value: 'About 5 min', source: 'spec/08 Audio Recap (~5-minute recap)' },
      { label: 'Recall mastery', value: '5 of 5 correct', source: 'spec/08 Recall item 6' },
      { label: 'Recall attempts', value: 'Up to 3', source: 'spec/08 Recall item 6' },
    ],
  },
  {
    id: 'petrios-ops',
    label: 'Petrios Ops',
    title: 'An AI assistant that never acts alone',
    body: 'The ops layer drafts what programme admin eats your week: speaker chases and post-session thank-yous. A moderator can also generate an editable one-page departmental newsletter from every teaching session and document in a completed week. Every outbound email waits for an explicit human approval — that invariant is enforced in code, not policy.',
    points: [
      'Revision-bound newsletter review and per-member retry-safe delivery',
      'Full audit trail of every AI run — prompt hashes, never prompt text; one kill switch',
    ],
    spec: [
      {
        label: 'Outbound email',
        value: 'Human approval first',
        source: 'spec/06; lib/ops/executors.ts is the only Ops send path',
      },
      { label: 'AI audit', value: 'Prompt hashes, not text', source: 'lib/ops/gateway.ts' },
      { label: 'Kill switch', value: <code>OPS_ENABLED=false</code>, source: 'lib/ops/flags.ts' },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    title: 'Certificates, audit, and equity',
    body: 'PDF certificates require the current finalized attendance revision and are publicly verifiable, visibly legacy, or revoked after correction. The audit dashboard covers sessions, certificates, members — and an equity lens showing attendance rates by grade, so scheduling patterns can be reviewed early.',
    points: [
      'Public certificate verification at /verify',
      'Private PDF, Word, and PowerPoint documents attached to each session',
      'Attendance equity by cohort with CSV export',
      'DTAC self-assessment and DPIA template included for NHS deployments',
    ],
    spec: [
      {
        label: 'Documents',
        value: 'PDF, DOCX, PPTX up to 25 MiB',
        source: 'lib/session-documents.ts SESSION_DOCUMENT_MAX_BYTES',
      },
      {
        label: 'Certificate coordinators',
        value: 'Up to 4',
        source: 'lib/certificates/coordinators.ts MAX_TEACHING_COORDINATORS; spec/05',
      },
      { label: 'Certificates', value: 'Publicly verifiable', source: 'spec/05; /verify/[certificateId]' },
    ],
  },
]

const SECTIONS = FEATURES.map(({ id, label }) => ({ id, label }))

export default function FeaturesPage() {
  return (
    <HudShell current="features">
      <PageHeader
        title="Everything a teaching programme runs on"
        lede="Not a content LMS — an operating system for live teaching: scheduling, attendance, feedback, evidence, and the admin in between."
      />

      <OnThisPage variant="chips" sections={SECTIONS} />

      {FEATURES.map((feature) => (
        <Panel
          key={feature.id}
          id={feature.id}
          aria-labelledby={`${feature.id}-title`}
          footer={<SpecStrip items={feature.spec} />}
        >
          <PanelTitle id={`${feature.id}-title`} label={feature.label}>
            {feature.title}
          </PanelTitle>
          <p className={clsx(s.body, 'mt-3')}>{feature.body}</p>
          <ul className={clsx(s.bullets, 'mt-4')}>
            {feature.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </Panel>
      ))}

      <Panel rule="none" aria-labelledby="features-cta-title" className={s.ctaPanel}>
        <h2 id="features-cta-title" className={s.sectionTitle}>
          See it with your own data
        </h2>
        <p className={s.sectionLede}>
          Join with your department code, or self-host the whole platform on your own infrastructure in an
          afternoon.
        </p>
        <div className={clsx(s.ctaRow, 'mt-5')}>
          <HudLink href="/join/dept" variant="primary">
            Join with a code
          </HudLink>
          <HudLink href="/open-source" variant="secondary">
            Self-host it
          </HudLink>
        </div>
      </Panel>
    </HudShell>
  )
}
