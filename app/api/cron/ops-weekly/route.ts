import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { getAppUrl } from '@/lib/app-url'
import { notifyUser } from '@/lib/notify'
import { profileDisplayName } from '@/lib/contacts'
import { opsEnabled } from '@/lib/ops/flags'
import { startRun } from '@/lib/ops/run'
import { draftChaseEmail } from '@/lib/ops/drafts'
import { buildOpsEmailHtml } from '@/lib/ops/email-html'
import { averageRating, formatSessionDateLabel } from '@/lib/ops/format'
import * as opsDb from '@/lib/db/ops'
import * as opsReads from '@/lib/db/ops-reads'
import * as auditDb from '@/lib/db/audit'
import * as onboardingDb from '@/lib/db/onboarding'

/**
 * Petrios Ops weekly pass. Two jobs, both read-only against core tables:
 *   1. Speaker chase — sessions <21 days out with no accepted teacher get a
 *      DRAFTED chase email per unresponsive invitee (max 2 chases each, 5-day
 *      spacing), queued as pending actions for human approval. Nothing sends
 *      from here.
 *   2. Low-score early warning — sessions that ended in the last 8 days with
 *      ≥3 responses averaging <3.5 trigger an in-app note to the department's
 *      moderators (internal signal, so it is not approval-gated).
 *
 * Run weekly: GET /api/cron/ops-weekly with Authorization: Bearer CRON_SECRET
 */

const CHASE_DRAFT_CAP = 10
const CHASE_MAX_PER_TARGET = 2
const CHASE_SPACING_DAYS = 5

export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized
  if (!opsEnabled()) {
    return NextResponse.json({ message: 'Petrios Ops is disabled', skipped: true })
  }

  const run = await startRun('ops_weekly', 'cron')
  try {
    const chased = await runSpeakerChase(run)
    const flagged = await runLowScoreWarning(run)

    const summary = `${chased} chase draft(s), ${flagged} low-score alert(s)`
    await run.finish('succeeded', summary)
    return NextResponse.json({ message: summary, chased, flagged })
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
