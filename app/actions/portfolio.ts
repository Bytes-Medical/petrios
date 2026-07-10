'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireAuth, requireOrg } from '@/lib/auth'
import { buildCoverage, type DomainCoverage } from '@/lib/ops/curriculum'
import { generatePortfolioPackPDF } from '@/lib/portfolio/pack-pdf'
import { generateDossierPDF } from '@/lib/portfolio/dossier-pdf'
import { averageRating } from '@/lib/ops/format'
import { exactDurationFromDates } from '@/lib/session-duration'
import { profileDisplayName } from '@/lib/contacts'
import * as traineeDashboardDb from '@/lib/db/trainee-dashboard'
import * as reflectionsDb from '@/lib/db/reflections'
import * as portfolioDb from '@/lib/db/portfolio'
import * as certificatesDb from '@/lib/db/certificates'
import * as onboardingDb from '@/lib/db/onboarding'
import * as opsDb from '@/lib/db/ops'
import * as sessionsDb from '@/lib/db/sessions'
import * as auditDb from '@/lib/db/audit'
import * as organizationsDb from '@/lib/db/organizations'
import type { AttendanceLogEntry } from '@/lib/db/trainee-dashboard'
import type { SessionReflection } from '@/lib/db/reflections'
import type { OpsSynthesisTheme } from '@/lib/types'

/**
 * Evidence Engine: the trainee "curriculum passport" + ARCP portfolio pack,
 * and the teacher appraisal/revalidation dossier. Everything here is
 * self-scoped — a user can only ever assemble evidence about themselves
 * (requireAuth + own userId throughout).
 */

export interface Passport {
  attendance: {
    entries: AttendanceLogEntry[]
    attended: number
    total: number
  }
  coverage: DomainCoverage[]
  reflections: SessionReflection[]
  certificates: { id: string; certificate_code: string; role: string; session_title: string }[]
}

export async function getMyPassport(): Promise<Passport> {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const [summary, reflections, certificates, domains, mappings] = await Promise.all([
    traineeDashboardDb.getAttendanceSummaryForUser(userId, orgId),
    reflectionsDb.listMyReflections(userId),
    certificatesDb.listMyCertificates(orgId, userId),
    opsDb.listCurriculumDomains(),
    opsDb.listMappingsForOrg(orgId),
  ])

  const attendedIds = new Set(
    summary.sessions
      .filter((s) => s.status === 'PRESENT' || s.status === 'LATE')
      .map((s) => s.session_id)
  )

  return {
    attendance: {
      entries: summary.sessions,
      attended: summary.attended,
      total: summary.total_sessions,
    },
    coverage: buildCoverage(domains, mappings, attendedIds),
    reflections,
    certificates: certificates.map((c) => ({
      id: c.id,
      certificate_code: c.certificate_code,
      role: c.certificate_role,
      session_title: c.sessions?.title ?? 'Session',
    })),
  }
}

export async function saveReflection(sessionId: string, body: string): Promise<{ success: true }> {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const trimmed = body.trim()
  if (!trimmed) throw new Error('Reflection is empty')
  if (trimmed.length > 4000) throw new Error('Reflection is too long (4000 characters max)')

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new Error('Session not found')

  await reflectionsDb.upsertMyReflection({ orgId, sessionId, userId, body: trimmed })
  revalidatePath('/dashboard')
  return { success: true }
}

export async function generatePortfolioPack(
  periodStartIso: string,
  periodEndIso: string
): Promise<{ base64: string; filename: string; packCode: string }> {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const periodStart = new Date(periodStartIso)
  const periodEnd = new Date(periodEndIso)
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
    throw new Error('Invalid period')
  }

  const [passport, profile, orgName] = await Promise.all([
    getMyPassport(),
    onboardingDb.findProfileByUserId(userId),
    organizationsDb.findOrganizationName(orgId),
  ])

  const inPeriod = (iso: string) =>
    new Date(iso) >= periodStart && new Date(iso) < periodEnd

  const entries = passport.attendance.entries.filter((e) => inPeriod(e.session_date))
  const attendedIds = new Set(
    entries.filter((e) => e.status === 'PRESENT' || e.status === 'LATE').map((e) => e.session_id)
  )
  const [domains, mappings] = await Promise.all([
    opsDb.listCurriculumDomains(),
    opsDb.listMappingsForOrg(orgId),
  ])
  const coverage = buildCoverage(domains, mappings, attendedIds)
  const reflections = passport.reflections.filter((r) =>
    entries.some((e) => e.session_id === r.session_id)
  )

  const displayName = profile ? profileDisplayName(profile, profile.email) : 'Member'
  const grade = profile?.grade ?? null
  const packCode = randomBytes(16).toString('hex')

  const payload = {
    name: displayName,
    grade,
    organization: orgName,
    period: { start: periodStartIso.slice(0, 10), end: periodEndIso.slice(0, 10) },
    attendance: entries.map((e) => ({
      session: e.session_title,
      date: e.session_date,
      status: e.status,
      source: e.primary_source,
    })),
    attended: attendedIds.size,
    total: entries.length,
    coverage: coverage.map((c) => ({ domain: c.name, sessions: c.sessionCount })),
    reflections: reflections.map((r) => ({
      session_id: r.session_id,
      body: r.body,
      updated_at: r.updated_at,
    })),
    certificate_codes: passport.certificates.map((c) => c.certificate_code),
  }

  await portfolioDb.insertPortfolioPack({
    orgId,
    userId,
    periodStart: periodStartIso.slice(0, 10),
    periodEnd: periodEndIso.slice(0, 10),
    packCode,
    payload,
  })

  const pdfBuffer = await generatePortfolioPackPDF({
    name: displayName,
    grade,
    organization: orgName ?? 'Organization',
    periodStart,
    periodEnd,
    entries,
    coverage,
    reflections: reflections.map((r) => ({
      sessionTitle:
        entries.find((e) => e.session_id === r.session_id)?.session_title ?? 'Session',
      body: r.body,
    })),
    certificateCodes: passport.certificates.map((c) => c.certificate_code),
    packCode,
  })

  return {
    base64: Buffer.from(pdfBuffer).toString('base64'),
    filename: `teaching-portfolio-${periodStartIso.slice(0, 10)}-to-${periodEndIso.slice(0, 10)}.pdf`,
    packCode,
  }
}

// ---------------------------------------------------------------------------
// Teacher dossier
// ---------------------------------------------------------------------------

export interface DossierSessionRow {
  title: string
  date: string
  durationMins: number
  attendees: number
  averageRating: number | null
  responses: number
}

export interface Dossier {
  sessionsTaught: DossierSessionRow[]
  totalHours: number
  totalAttendees: number
  overallAverageRating: number | null
  themes: OpsSynthesisTheme[]
}

export async function getMyTeachingDossier(
  periodStartIso: string,
  periodEndIso: string
): Promise<Dossier> {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const taught = await portfolioDb.listTaughtSessionsInPeriod(
    userId,
    orgId,
    periodStartIso,
    periodEndIso
  )
  const sessionIds = taught.map((s) => s.session_id)

  const [attendeeCounts, ratings, syntheses] = await Promise.all([
    portfolioDb.countAttendeesForSessions(sessionIds),
    auditDb.listFeedbackRatingsForSessions(sessionIds),
    opsDb.listSynthesesForSessions(sessionIds),
  ])

  const rows: DossierSessionRow[] = taught.map((s) => {
    const sessionRatings = ratings
      .filter((r) => r.session_id === s.session_id && r.rating !== null)
      .map((r) => r.rating as number)
    return {
      title: s.title,
      date: s.date_start,
      durationMins: exactDurationFromDates(s.date_start, s.date_end),
      attendees: attendeeCounts.get(s.session_id) ?? 0,
      averageRating: sessionRatings.length ? averageRating(sessionRatings) : null,
      responses: sessionRatings.length,
    }
  })

  const allRatings = ratings.filter((r) => r.rating !== null).map((r) => r.rating as number)
  // Themes from safety-cleared syntheses only.
  const themes = syntheses
    .filter((s) => !s.requires_human_review)
    .flatMap((s) => s.themes)
    .slice(0, 10)

  return {
    sessionsTaught: rows,
    totalHours: Math.round((rows.reduce((sum, r) => sum + r.durationMins, 0) / 60) * 10) / 10,
    totalAttendees: rows.reduce((sum, r) => sum + r.attendees, 0),
    overallAverageRating: allRatings.length ? averageRating(allRatings) : null,
    themes,
  }
}

export async function downloadTeachingDossier(
  periodStartIso: string,
  periodEndIso: string
): Promise<{ base64: string; filename: string }> {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const [dossier, profile, orgName] = await Promise.all([
    getMyTeachingDossier(periodStartIso, periodEndIso),
    onboardingDb.findProfileByUserId(userId),
    organizationsDb.findOrganizationName(orgId),
  ])

  const pdfBuffer = await generateDossierPDF({
    name: profile ? profileDisplayName(profile, profile.email) : 'Teacher',
    organization: orgName ?? 'Organization',
    periodStart: new Date(periodStartIso),
    periodEnd: new Date(periodEndIso),
    dossier,
  })

  return {
    base64: Buffer.from(pdfBuffer).toString('base64'),
    filename: `teaching-dossier-${periodStartIso.slice(0, 10)}-to-${periodEndIso.slice(0, 10)}.pdf`,
  }
}
