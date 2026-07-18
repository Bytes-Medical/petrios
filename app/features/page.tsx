import Link from 'next/link'
import { PublicNav } from '@/components/PublicNav'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Features',
  description:
    'Everything a clinical teaching programme runs on with Petrios: evidence-based attendance, built-in video, claimable slots, AI with human approval, and portfolio-ready evidence.',
  alternates: { canonical: '/features' },
}

interface Feature {
  eyebrow: string
  title: string
  body: string
  points: string[]
}

const FEATURES: Feature[] = [
  {
    eyebrow: 'Attendance',
    title: 'Evidence, not box-ticking',
    body: 'Attendance is computed from an append-only evidence pipeline — teacher marking, video joins, feedback submissions, group codes, and self check-in, each with its own validity window and priority. The record shows how presence was proven, can be locked after the session, and exports to CSV.',
    points: [
      'QR and rotating group codes for low-friction check-in',
      'Joining the built-in video room checks you in automatically',
      'Missed it? Pass three recall questions within 21 days and attendance is recorded — honestly labelled as caught-up',
      'Full audit trail; locked sessions never silently change',
    ],
  },
  {
    eyebrow: 'Petrios Meet',
    title: 'Video built in, not bolted on',
    body: 'Give any session a video room with zero setup — no links to paste, ever. Rooms are generated per session, embedded in the session page for members, and joinable by external guests with a plain link. Swap the backend for your own Jitsi server with one environment variable.',
    points: [
      'Auto-generated rooms on Jitsi (self-hostable)',
      'Embedded joining records attendance evidence',
      'Microsoft Teams links equally supported for Teams-first trusts',
    ],
  },
  {
    eyebrow: 'Scheduling',
    title: 'Claimable teaching slots',
    body: 'Publish your programme’s empty slots Calendly-style — to contact groups from the address book, to all registered members, or both. First to claim gets the slot, atomically; a draft session is created with the claimer attached as an accepted teacher, and you assign the topic later.',
    points: [
      'External teachers claim via email links — no account needed',
      'Teacher invitations with accept/decline and automatic 24h reminders',
      'Open slots render as “Available” on the shared calendar (ICS feed included)',
    ],
  },
  {
    eyebrow: 'Feedback',
    title: 'Anonymous feedback, safely summarised',
    body: 'Attendees scan a QR and answer your department’s custom form — anonymous by design. AI summarises themes and suggestions for the teacher, with hard safety rails: names are stripped, and anything raising welfare or conduct concerns is routed to a human and excluded from every AI output.',
    points: [
      'Custom per-department forms with 1–5 scored questions',
      'Live stats, AI theme summaries, teacher feedback release',
      'Low-scoring sessions alert moderators automatically',
    ],
  },
  {
    eyebrow: 'Evidence Engine',
    title: 'Portfolio-ready proof, one click',
    body: 'Trainees get a curriculum passport — which RCPCH Progress+ domains their attended teaching covered, with gaps highlighted — plus per-session reflections and a verifiable ARCP portfolio pack. Teachers get an appraisal-ready dossier: sessions taught, hours, reach, and anonymised feedback themes.',
    points: [
      'Portfolio packs are snapshotted and publicly verifiable by code',
      'Signed, portable teaching records survive rotating between trusts',
      'Spaced recall questions (+3 and +14 days) turn attendance into retention',
    ],
  },
  {
    eyebrow: 'Petrios Ops',
    title: 'An AI assistant that never acts alone',
    body: 'The ops layer drafts what programme admin eats your week: speaker chases for unconfirmed sessions, post-session thank-yous with feedback insights, and a weekly learning-points newsletter. Every outbound email waits in an approval queue until a human says send — that invariant is enforced in code, not policy.',
    points: [
      'Curriculum gap watch across Progress+ domains',
      'Full audit trail of every AI run — prompt hashes, never prompt text; one kill switch',
    ],
  },
  {
    eyebrow: 'Governance',
    title: 'Certificates, audit, and equity',
    body: 'Automatic PDF certificates for teachers and attendees, publicly verifiable by code. The audit dashboard covers sessions, certificates, members — and an equity lens showing attendance rates by grade, so scheduling that excludes a cohort is visible before the GMC survey says so.',
    points: [
      'Public certificate verification at /verify',
      'Attendance equity by cohort with CSV export',
      'DTAC self-assessment and DPIA template included for NHS deployments',
    ],
  },
]

export default function FeaturesPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav current="features" />
      <main className="flex-1 px-4 py-10 sm:py-14 bg-dotgrid">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
            <h1 className="font-mono text-3xl font-bold sm:text-4xl">
              Everything a teaching programme runs on
            </h1>
            <p className="mx-auto mt-3 max-w-2xl font-mono text-sm text-gray-700 leading-relaxed">
              Not a content LMS — an operating system for live teaching:
              scheduling, attendance, feedback, evidence, and the admin in
              between.
            </p>
          </div>

          <div className="space-y-6">
            {FEATURES.map((feature) => (
              <section
                key={feature.title}
                className="border border-black border-t-4 border-t-clay-600 bg-white p-6 shadow-[8px_8px_0_rgba(31,29,26,0.08)] sm:p-8"
              >
                <p className="font-mono text-xs uppercase tracking-wide text-clay-700">
                  {feature.eyebrow}
                </p>
                <h2 className="mt-1 font-mono text-xl font-bold sm:text-2xl">{feature.title}</h2>
                <p className="mt-3 font-mono text-sm text-gray-700 leading-relaxed">
                  {feature.body}
                </p>
                <ul className="mt-4 space-y-1.5 font-mono text-sm text-gray-700">
                  {feature.points.map((point) => (
                    <li key={point}>
                      <span className="text-clay-600">▸</span> {point}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-10 border border-black bg-white p-6 text-center shadow-[8px_8px_0_rgba(31,29,26,0.08)] sm:p-8">
            <h2 className="font-mono text-xl font-bold">See it with your own data</h2>
            <p className="mx-auto mt-2 max-w-xl font-mono text-sm text-gray-700">
              Join with your department code, or self-host the whole platform
              on your own infrastructure in an afternoon.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3 font-mono text-sm">
              <Link
                href="/join/dept"
                className="border border-black bg-black px-4 py-2 text-white hover:bg-gray-800"
              >
                Join with a code
              </Link>
              <Link
                href="/open-source"
                className="border border-black bg-white px-4 py-2 hover:bg-gray-50"
              >
                Self-host it →
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
