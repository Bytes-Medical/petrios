import type { NewsletterRenderInput } from './newsletter-render'

/**
 * Test fixture: the approved design sample (Paediatrics — Doncaster Royal
 * Infirmary, w/c 5 Oct 2026), copied from the design hand-off's build.mjs.
 * Rendering it must reproduce the approved mockups (desktop-600, mobile-375,
 * dark). Test-only; never imported by application code.
 */

export const PDF = 'application/pdf'
export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export const SAMPLE_IDS = {
  asthma: '1b6e9f40-2c7d-4a1e-8f3b-5d9c0a7e2b11',
  skin: '4c2a7b19-8e3f-4d6a-b1c5-9f0e2d7a3c48',
  mdt: '9e5d3c71-0a4b-4f2e-a6d8-1b7c3e9f5a20',
} as const

export const SAMPLE_DEPARTMENT_ID = '7d3f1c2a-5b8e-4f6a-9c1d-2e4b6a8c0f13'

export function sampleNewsletterInput(): NewsletterRenderInput {
  const ids = SAMPLE_IDS
  return {
    appUrl: 'https://petrios.example',
    timeZone: 'Europe/London',
    organizationName: 'Doncaster & Bassetlaw Teaching Hospitals',
    departmentName: 'Paediatrics — Doncaster Royal Infirmary',
    departmentId: SAMPLE_DEPARTMENT_ID,
    weekStartKey: '2026-10-05',
    content: {
      subject: 'Wheeze, newborn rashes and a radiology round-up',
      intro: 'Three sessions this week: recognising and escalating acute asthma, telling benign newborn rashes from the ones that need same-day review, and our monthly radiology MDT.',
      sessions: [
        {
          session_id: ids.asthma,
          title: 'Acute asthma in children: recognition and escalation',
          date_label: 'Tuesday 6 October',
          overview: 'A case-based walk through a school-age child with acute wheeze, from first assessment in the emergency department to deciding when to escalate, finishing with a structured look at discharge.',
          learning_points: [
            'Grade severity on the whole picture (SpO2, ability to talk, respiratory and heart rate, work of breathing) and reassess after every intervention.',
            'A silent chest, cyanosis, poor respiratory effort, exhaustion or altered consciousness are life-threatening: call your senior and the anaesthetic/PICU team early.',
            'Before discharge, check inhaler and spacer technique, give a written asthma action plan and arrange early follow-up in primary care.',
          ],
        },
        {
          session_id: ids.skin,
          title: 'Neonatal skin: what’s normal, what’s not',
          date_label: 'Wednesday 7 October',
          overview: 'A photo-led tour of common newborn skin findings, separating benign transient rashes from presentations that need same-day senior review.',
          learning_points: [
            'Erythema toxicum neonatorum and transient neonatal pustular melanosis are common and self-limiting: reassure, and avoid investigating a well baby.',
            'Vesicles in a newborn mean HSV until proven otherwise: swab for PCR and discuss starting aciclovir with a senior without delay.',
            'Record the size and site of haemangiomas; periocular, “beard”-distribution or large segmental lesions need early referral.',
          ],
        },
        {
          session_id: ids.mdt,
          title: 'Paediatric radiology MDT',
          date_label: 'Thursday 8 October',
          // No files: the overview restates the session description; no key points.
          overview: 'Our monthly case review with the paediatric radiology team, working through imaging from recent admissions. Bring cases and questions from the ward.',
          learning_points: [],
        },
      ],
      closing: 'Thank you to this week’s teachers, and to everyone who brought cases and questions up from the ward.',
    },
    sourceDocuments: [
      { sessionId: ids.asthma, mimeType: PDF }, { sessionId: ids.asthma, mimeType: PDF }, { sessionId: ids.asthma, mimeType: PPTX },
      { sessionId: ids.skin, mimeType: PPTX }, { sessionId: ids.skin, mimeType: PDF },
    ],
    render: {
      version: 1,
      snapshotAt: '2026-10-11T19:02:00.000Z',
      organizationName: 'Doncaster & Bassetlaw Teaching Hospitals',
      departmentName: 'Paediatrics — Doncaster Royal Infirmary',
      coordinators: ['Dr Sarah Lindqvist', 'Dr Femi Adeyemi'],
      sessions: {
        [ids.asthma]: { dateStart: '2026-10-06T11:30:00.000Z', dateEnd: '2026-10-06T13:00:00.000Z', locationType: 'IN_PERSON', teachers: ['Dr Hannah Whitfield', 'Joanne Pryce'], recap: { durationSeconds: 312 } },
        [ids.skin]: { dateStart: '2026-10-07T12:00:00.000Z', dateEnd: '2026-10-07T13:00:00.000Z', locationType: 'JITSI', teachers: ['Dr Priya Raman'], recap: null },
        [ids.mdt]: { dateStart: '2026-10-08T11:30:00.000Z', dateEnd: '2026-10-08T12:30:00.000Z', locationType: 'HYBRID', teachers: ['Dr Marcus Bell', 'Dr Hannah Whitfield'], recap: null },
      },
      upcoming: {
        startIso: '2026-10-11T23:00:00.000Z',
        endIso: '2026-10-18T23:00:00.000Z',
        more: 0,
        sessions: [
          { id: '2f8a4d60-7b1c-4e3a-9d5f-0c6b8e2a4f37', title: 'Bronchiolitis season: assessment, oxygen and feeding support', dateStart: '2026-10-13T11:30:00.000Z', dateEnd: '2026-10-13T12:30:00.000Z', locationType: 'IN_PERSON', teachers: ['Dr Hannah Whitfield'] },
          { id: '6a0c9e83-3d5b-4a7f-8e2c-4b1d7f9a0e65', title: 'Bruising in non-mobile infants: the safeguarding pathway', dateStart: '2026-10-14T12:00:00.000Z', dateEnd: '2026-10-14T13:00:00.000Z', locationType: 'JITSI', teachers: ['Dr Aisha Karim'] },
          { id: 'c3e7b2d9-5f1a-4c8e-b0d4-7a9e1f3c5b82', title: 'Prescribing maintenance fluids', dateStart: '2026-10-16T07:15:00.000Z', dateEnd: '2026-10-16T07:30:00.000Z', locationType: 'IN_PERSON', teachers: ['Dr Tom Ashworth'] },
        ],
      },
    },
  }
}

export const stressUuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** build.mjs stress(): n sessions, each with files, a recap and two teachers. */
export function stressNewsletterInput(
  nSessions: number,
  wordsPerOverview: number,
  points: number,
  options: { title?: string; teachers?: string[] } = {}
): NewsletterRenderInput {
  const input = sampleNewsletterInput()
  input.content.sessions = []
  input.render.sessions = {}
  input.sourceDocuments = []
  for (let i = 0; i < nSessions; i++) {
    const id = stressUuid(i + 1)
    input.content.sessions.push({
      session_id: id,
      title: options.title ?? 'Structured approach to the acutely unwell child on the ward round '.slice(0, 66),
      date_label: 'Monday 5 October',
      overview: Array.from({ length: wordsPerOverview }, () => 'teaching').join(' '),
      learning_points: Array.from({ length: points }, () => Array.from({ length: 24 }, () => 'point').join(' ')),
    })
    input.render.sessions[id] = {
      dateStart: '2026-10-05T08:00:00.000Z',
      dateEnd: '2026-10-05T09:00:00.000Z',
      locationType: 'HYBRID',
      teachers: options.teachers ?? ['Dr Alexandra Whitfield-Montgomery', 'Dr Priya Raman'],
      recap: { durationSeconds: 300 },
    }
    input.sourceDocuments.push({ sessionId: id, mimeType: PDF }, { sessionId: id, mimeType: PPTX })
  }
  const first = input.render.upcoming.sessions[0]
  input.render.upcoming.sessions = Array.from({ length: 6 }, (_, i) => ({ ...first, id: stressUuid(900 + i) }))
  return input
}
