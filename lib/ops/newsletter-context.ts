import * as opsReads from '@/lib/db/ops-reads'
import type { OpsSessionRow } from '@/lib/db/ops-reads'
import * as audioRecapsDb from '@/lib/db/audio-recaps'
import * as departmentsDb from '@/lib/db/departments'
import * as organizationsDb from '@/lib/db/organizations'
import { appDayKey, appWallClockToIso } from '@/lib/datetime'
import type { SessionDocument } from '@/lib/db/session-documents'
import type { OpsNewsletterSourceDocument } from '@/lib/types'
import { NEWSLETTER_UPCOMING_LIMIT } from './newsletter-render'
import { buildRecapSourceSnapshot, recapSourcesAreCurrent } from './recap-sources'
import {
  NEWSLETTER_RENDER_NAME_MAX,
  NewsletterRenderContextSchema,
  type NewsletterRenderContext,
  type WeekWindow,
} from './newsletter'

/**
 * The newsletter render snapshot (`content.render`, spec 06): everything the
 * email template shows beyond the AI/moderator narrative, captured ONCE at
 * generation. Saving an edit re-renders from the stored snapshot and sending
 * never re-reads it, so the moderator approves exactly what is sent.
 *
 * Reads only the organisation name, session timing/format, accepted teacher
 * names, approved Audio Recap durations, coordinator names and the
 * department's upcoming published sessions. It never reads attendance, feedback, reflections, certificates or
 * assessment data (enforced by newsletter-render.test.ts).
 *
 * Every read is a service-role SELECT; callers have already passed
 * requireOpsManager and requireDepartmentModerator for this department.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_TEACHERS = 8
const MAX_NAME = 120
const MAX_TITLE = 180
const MAX_COORDINATORS = 4
const MAX_RECAP_SECONDS = 3600
const LOCATION_TYPES = new Set(['MS_TEAMS', 'IN_PERSON', 'HYBRID', 'JITSI'])

/** PostgREST returns timestamptz with an offset; the snapshot stores UTC `Z`. */
const iso = (value: string) => new Date(value).toISOString()
const clip = (value: string, max: number) => value.trim().slice(0, max).trim()
const names = (values: string[] | undefined) =>
  (values ?? []).map((name) => clip(name, MAX_NAME)).filter(Boolean).slice(0, MAX_TEACHERS)
function locationType(value: string): NewsletterRenderContext['sessions'][string]['locationType'] {
  if (!LOCATION_TYPES.has(value)) throw new Error(`Unexpected session location type ${value}`)
  return value as NewsletterRenderContext['sessions'][string]['locationType']
}

/** 'YYYY-MM-DD' calendar arithmetic (no zone: day keys are plain dates). */
const addDays = (dayKey: string, days: number) =>
  new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
const localMidnight = (dayKey: string) => new Date(appWallClockToIso(`${dayKey}T00:00`))

/**
 * "Coming up" window in APP_TIME_ZONE local days: from local midnight on the
 * Monday after the newsletter week (or `now`, if later, so an old week drafted
 * late never lists past sessions) to local midnight seven calendar days after
 * that start's local day. Local midnights keep the rendered range at exactly
 * seven days in BST and GMT alike.
 */
export function newsletterUpcomingWindow(
  weekEnd: Date,
  now: Date
): { start: Date; end: Date } {
  const nextWeek = localMidnight(weekEnd.toISOString().slice(0, 10))
  const start = new Date(Math.max(now.getTime(), nextWeek.getTime()))
  return { start, end: localMidnight(addDays(appDayKey(start), 7)) }
}

/**
 * Sessions whose approved Audio Recap is still playable on the session page:
 * the recap's stored source digest must match the session's current teaching
 * files (the same rule as getApprovedAudioRecap), so the email never
 * advertises a recap the page hides.
 */
function sourceCurrentRecapSessions(
  recaps: { session_id: string; source_digest: string | null }[],
  documents: Pick<OpsNewsletterSourceDocument, 'sessionId' | 'id' | 'filename' | 'mimeType' | 'byteSize' | 'sha256'>[]
): Set<string> {
  const current = new Set<string>()
  for (const recap of recaps) {
    const snapshot = buildRecapSourceSnapshot(
      documents
        .filter((document) => document.sessionId === recap.session_id)
        .map((document) => ({
          id: document.id,
          display_name: document.filename,
          mime_type: document.mimeType as SessionDocument['mime_type'],
          byte_size: document.byteSize,
          sha256: document.sha256,
        }))
    )
    if (recapSourcesAreCurrent(recap.source_digest, snapshot)) current.add(recap.session_id)
  }
  return current
}

export async function loadNewsletterRenderContext(input: {
  orgId: string
  departmentId: string
  departmentName: string
  sessions: OpsSessionRow[]
  /** Every current teaching document of the newsletter sessions (the
   *  generation's source snapshot, read with listSessionDocumentsAsSystem). */
  sourceDocuments: Pick<OpsNewsletterSourceDocument, 'sessionId' | 'id' | 'filename' | 'mimeType' | 'byteSize' | 'sha256'>[]
  window: Pick<WeekWindow, 'weekEnd'>
  now?: Date
}): Promise<NewsletterRenderContext> {
  const now = input.now ?? new Date()
  const ids = input.sessions.map((session) => session.id)
  const { start: upStart, end: upEnd } = newsletterUpcomingWindow(input.window.weekEnd, now)

  const [organizationName, teacherNames, recaps, settings, upcoming] = await Promise.all([
    organizationsDb.findOrganizationName(input.orgId),
    opsReads.listAcceptedTeacherNamesForSessions(ids),
    audioRecapsDb.listApprovedRecapDurations(ids),
    departmentsDb.findDepartmentSettings(input.departmentId, input.orgId),
    opsReads.listDepartmentSessionsStartingInWindow(
      input.orgId,
      input.departmentId,
      upStart.toISOString(),
      upEnd.toISOString(),
      NEWSLETTER_UPCOMING_LIMIT + 1
    ),
  ])
  const upcomingRows = upcoming.sessions.slice(0, NEWSLETTER_UPCOMING_LIMIT)
  const upcomingNames = await opsReads.listAcceptedTeacherNamesForSessions(
    upcomingRows.map((session) => session.id)
  )

  const playable = sourceCurrentRecapSessions(recaps, input.sourceDocuments)
  const recapSeconds = new Map<string, number>()
  for (const recap of recaps) {
    if (!playable.has(recap.session_id)) continue
    const seconds = Math.round(Number(recap.audio_duration_seconds))
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_RECAP_SECONDS) {
      recapSeconds.set(recap.session_id, seconds)
    }
  }

  const snapshot: NewsletterRenderContext = {
    version: 1,
    snapshotAt: now.toISOString(),
    organizationName: clip(organizationName ?? '', NEWSLETTER_RENDER_NAME_MAX) || 'Petrios',
    departmentName: clip(input.departmentName, NEWSLETTER_RENDER_NAME_MAX),
    coordinators: (settings?.coordinatorNames ?? [])
      .map((name) => clip(name, MAX_NAME))
      .filter(Boolean)
      .slice(0, MAX_COORDINATORS),
    sessions: Object.fromEntries(input.sessions.map((session) => [session.id, {
      dateStart: iso(session.date_start),
      dateEnd: iso(session.date_end),
      locationType: locationType(session.location_type),
      teachers: names(teacherNames.get(session.id)),
      recap: recapSeconds.has(session.id) ? { durationSeconds: recapSeconds.get(session.id)! } : null,
    }])),
    upcoming: {
      startIso: upStart.toISOString(),
      endIso: upEnd.toISOString(),
      more: Math.max(0, upcoming.total - upcomingRows.length),
      sessions: upcomingRows.map((session) => ({
        id: session.id,
        title: clip(session.title, MAX_TITLE),
        dateStart: iso(session.date_start),
        dateEnd: iso(session.date_end),
        locationType: locationType(session.location_type),
        teachers: names(upcomingNames.get(session.id)),
      })),
    },
  }

  const keys = Object.keys(snapshot.sessions).sort()
  const expected = [...new Set(ids)].sort()
  if (keys.length !== expected.length || keys.some((id, index) => id !== expected[index])) {
    throw new Error('Newsletter render context does not cover exactly the newsletter sessions')
  }
  return NewsletterRenderContextSchema.parse(snapshot)
}
