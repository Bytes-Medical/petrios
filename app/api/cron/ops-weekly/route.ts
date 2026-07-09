import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { getAppUrl } from '@/lib/app-url'
import { notifyUser } from '@/lib/notify'
import { profileDisplayName } from '@/lib/contacts'
import { opsEnabled } from '@/lib/ops/flags'
import { startRun } from '@/lib/ops/run'
import { draftChaseEmail } from '@/lib/ops/drafts'
import { buildOpsEmailHtml } from '@/lib/ops/email-html'
import { buildCoverage, mapSessionDomains } from '@/lib/ops/curriculum'
import { averageRating, formatSessionDateLabel } from '@/lib/ops/format'
import { opsInference } from '@/lib/ops/gateway'
import * as opsDb from '@/lib/db/ops'
import * as opsReads from '@/lib/db/ops-reads'
import * as auditDb from '@/lib/db/audit'
import * as onboardingDb from '@/lib/db/onboarding'

/**
 * Bytes Ops weekly pass. Three jobs, all read-only against core tables:
 *   1. Speaker chase — sessions <21 days out with no accepted teacher get a
 *      DRAFTED chase email per unresponsive invitee (max 2 chases each, 5-day
 *      spacing), queued as pending actions for human approval. Nothing sends
 *      from here.
 *   2. Low-score early warning — sessions that ended in the last 8 days with
 *      ≥3 responses averaging <3.5 trigger an in-app note to the department's
 *      moderators (internal signal, so it is not approval-gated).
 *   3. Curriculum gap watch — maps unmapped recent sessions to Progress+
 *      domains and alerts org admins when the uncovered-domain set changes.
 *
 * Run weekly: GET /api/cron/ops-weekly?secret=CRON_SECRET
 */

const CHASE_DRAFT_CAP = 10
const CHASE_MAX_PER_TARGET = 2
const CHASE_SPACING_DAYS = 5
const MAPPING_CAP = 15

export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized
  if (!opsEnabled()) {
    return NextResponse.json({ message: 'Bytes Ops is disabled', skipped: true })
  }

  const run = await startRun('ops_weekly', 'cron')
  try {
    const chased = await runSpeakerChase(run)
    const flagged = await runLowScoreWarning(run)
    const mapped = await runGapWatch(run)

    const summary = `${chased} chase draft(s), ${flagged} low-score alert(s), ${mapped} session(s) mapped`
    await run.finish('succeeded', summary)
    return NextResponse.json({ message: summary, chased, flagged, mapped })
  } catch (err) {
    console.error('ops-weekly failed:', err)
    await run.finish('failed', err instanceof Error ? err.message : 'unknown error')
    return NextResponse.json({ error: 'ops-weekly failed' }, { status: 500 })
  }
}

async function runSpeakerChase(run: Awaited<ReturnType<typeof startRun>>): Promise<number> {
  const sessions = await opsReads.listUpcomingPublishedSessions(21)
  const sessionIds = sessions.map((s) => s.id)
  const [teachers, invitations] = await Promise.all([
    opsReads.listTeachersForSessions(sessionIds),
    opsReads.listInvitationsForSessions(sessionIds),
  ])
  await run.log('chase:scan', { sessions: sessions.length })

  // Pending chase actions per org — don't draft a duplicate while one waits.
  const pendingByOrg = new Map<string, Set<string>>()
  async function alreadyQueued(orgId: string, sessionId: string, email: string) {
    if (!pendingByOrg.has(orgId)) {
      const pending = await opsDb.listPendingActions(orgId, { statuses: ['pending'] })
      pendingByOrg.set(
        orgId,
        new Set(
          pending
            .filter((a) => a.type === 'SPEAKER_CHASE_EMAIL')
            .map((a) => `${a.payload.sessionId}:${String(a.payload.email).toLowerCase()}`)
        )
      )
    }
    return pendingByOrg.get(orgId)!.has(`${sessionId}:${email.toLowerCase()}`)
  }

  const appUrl = getAppUrl()
  let drafted = 0

  for (const session of sessions) {
    if (drafted >= CHASE_DRAFT_CAP) break

    const sessionTeachers = teachers.filter((t) => t.session_id === session.id)
    const sessionInvitations = invitations.filter((i) => i.session_id === session.id)
    const hasAccepted =
      sessionTeachers.some((t) => t.status === 'ACCEPTED') ||
      sessionInvitations.some((i) => i.status === 'ACCEPTED')
    if (hasAccepted) continue

    const pendingTeachers = sessionTeachers.filter((t) => t.status === 'PENDING')
    const pendingInvitations = sessionInvitations.filter((i) => i.status === 'PENDING')
    if (pendingTeachers.length === 0 && pendingInvitations.length === 0) continue

    const [chaseCounts, profiles] = await Promise.all([
      opsDb.getChaseCounts(session.id),
      onboardingDb.listProfilesForUsers(pendingTeachers.map((t) => t.user_id)),
    ])

    interface Target {
      email: string
      name: string
      userId?: string
      invitationId?: string
      ctaUrl: string
      isExternal: boolean
    }
    const targets: Target[] = []
    for (const teacher of pendingTeachers) {
      const profile = profiles.find((p) => p.user_id === teacher.user_id)
      if (!profile?.email) continue
      targets.push({
        email: profile.email,
        name: profileDisplayName(profile, profile.email),
        userId: teacher.user_id,
        ctaUrl: `${appUrl}/dashboard?tab=teaching`,
        isExternal: false,
      })
    }
    for (const invitation of pendingInvitations) {
      const name =
        [invitation.first_name, invitation.last_name].filter(Boolean).join(' ') ||
        invitation.email
      targets.push({
        email: invitation.email,
        name,
        invitationId: invitation.id,
        ctaUrl: `${appUrl}/sessions/${session.id}/teacher-rsvp/${invitation.invite_code}`,
        isExternal: true,
      })
    }

    for (const target of targets) {
      if (drafted >= CHASE_DRAFT_CAP) break

      const count = chaseCounts.get(target.email.toLowerCase()) ?? 0
      if (count >= CHASE_MAX_PER_TARGET) continue
      if (await alreadyQueued(session.org_id, session.id, target.email)) continue

      const draft = await draftChaseEmail(
        {
          recipientName: target.name,
          sessionTitle: session.title,
          dateLabel: formatSessionDateLabel(session.date_start),
          chaseNumber: count + 1,
          isExternal: target.isExternal,
        },
        run
      )

      await opsDb.insertPendingAction({
        orgId: session.org_id,
        departmentId: session.department_id,
        type: 'SPEAKER_CHASE_EMAIL',
        payload: {
          sessionId: session.id,
          email: target.email,
          subject: draft.subject,
          html: buildOpsEmailHtml({
            heading: draft.subject,
            bodyText: draft.body,
            ctaLabel: 'Respond to invitation',
            ctaUrl: target.ctaUrl,
          }),
          targetUserId: target.userId,
          targetInvitationId: target.invitationId,
        },
        previewTitle: `Chase ${target.name} — "${session.title}"`,
        previewBody: `To: ${target.email}\nSubject: ${draft.subject}\n\n${draft.body}`,
      })
      drafted++
    }
  }

  await run.log('chase:done', { drafted })
  return drafted
}

async function runLowScoreWarning(run: Awaited<ReturnType<typeof startRun>>): Promise<number> {
  // Window-based idempotency: only sessions that ended since the last weekly
  // pass (8 days, one day of overlap tolerance) are considered.
  const organizations = await opsReads.listOrganizations()
  const now = Date.now()
  const windowStart = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now).toISOString()

  let alerts = 0
  // Sessions in a department share moderators — fetch each department once.
  const moderatorsByDept = new Map<string, string[]>()

  for (const org of organizations) {
    const sessions = await opsReads.listSessionsEndedInWindow(org.id, windowStart, windowEnd, 50)
    if (sessions.length === 0) continue

    const ratings = await auditDb.listFeedbackRatingsForSessions(sessions.map((s) => s.id))
    for (const session of sessions) {
      const sessionRatings = ratings
        .filter((r) => r.session_id === session.id && r.rating !== null)
        .map((r) => r.rating as number)
      if (sessionRatings.length < 3) continue
      const avg = averageRating(sessionRatings)
      if (avg >= 3.5) continue

      let moderators = moderatorsByDept.get(session.department_id)
      if (!moderators) {
        moderators = await opsReads.listDepartmentModeratorUserIds(session.department_id)
        moderatorsByDept.set(session.department_id, moderators)
      }
      for (const moderator of moderators) {
        await notifyUser({
          orgId: org.id,
          userId: moderator,
          notification: {
            type: 'OPS_LOW_SCORE',
            title: `Low feedback score: "${session.title}"`,
            body: `Averaged ${avg}/5 across ${sessionRatings.length} responses. Worth a look at the raw feedback.`,
            link: `/sessions/${session.id}/manage`,
          },
        })
      }
      alerts++
      await run.log('low-score:flagged', {
        sessionId: session.id,
        avg,
        responses: sessionRatings.length,
      })
    }
  }
  return alerts
}

async function runGapWatch(run: Awaited<ReturnType<typeof startRun>>): Promise<number> {
  const organizations = await opsReads.listOrganizations()
  const domains = await opsDb.listCurriculumDomains()
  if (domains.length === 0) return 0

  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
  let mapped = 0

  for (const org of organizations) {
    if (org.is_personal) continue

    const sessions = await opsReads.listPublishedSessionsForOrgSince(org.id, since)
    if (sessions.length < 5) continue // too little teaching to call anything a "gap"

    const alreadyMapped = await opsDb.listMappedSessionIds(sessions.map((s) => s.id))
    for (const session of sessions) {
      if (mapped >= MAPPING_CAP) break
      if (alreadyMapped.has(session.id)) continue
      await mapSessionDomains(session, domains, run)
      mapped++
    }

    const mappings = await opsDb.listMappingsForOrg(org.id)
    const coverage = buildCoverage(domains, mappings, new Set(sessions.map((s) => s.id)))
    const uncovered = coverage.filter((c) => c.sessionCount === 0)
    if (uncovered.length === 0) continue

    // Only alert when the uncovered set CHANGES — ops_memory remembers the
    // last alerted state so admins aren't re-notified every week.
    const memoryKey = 'gap_watch_uncovered'
    const memory = await opsDb.listMemory(org.id, 100)
    const previous = memory.find((m) => m.key === memoryKey)?.value
    const current = uncovered.map((c) => c.code).sort().join(',')
    if (previous === current) continue

    const suggestions = await opsInference({
      purpose: 'gap_topics',
      system:
        'You suggest paediatric teaching session topics for an NHS teaching programme. Be concrete and brief.',
      prompt: `This term's teaching has no sessions covering these RCPCH Progress+ domains:\n${uncovered
        .map((c) => `- ${c.name}`)
        .join('\n')}\n\nSuggest one specific session topic per domain, as a short plain-text list.`,
      maxTokens: 1024,
      run,
      stepName: `gap-topics:${org.id}`,
    })

    const admins = await opsReads.listOrgAdminUserIds(org.id)
    for (const admin of admins) {
      await notifyUser({
        orgId: org.id,
        userId: admin,
        notification: {
          type: 'OPS_CURRICULUM_GAP',
          title: `Curriculum gaps: ${uncovered.length} domain(s) uncovered this term`,
          body:
            uncovered.map((c) => c.name).join(', ') +
            (suggestions ? ` — topic ideas on the Ops curriculum page.` : ''),
          link: '/ops/curriculum',
        },
      })
    }
    await opsDb.upsertMemory({
      orgId: org.id,
      key: memoryKey,
      value: current,
      source: 'gap_watch',
    })
    if (suggestions) {
      await opsDb.upsertMemory({
        orgId: org.id,
        key: 'gap_watch_suggestions',
        value: suggestions.slice(0, 2000),
        source: 'gap_watch',
      })
    }
    await run.log('gap-watch:alerted', { orgId: org.id, uncovered: uncovered.length })
  }
  return mapped
}
