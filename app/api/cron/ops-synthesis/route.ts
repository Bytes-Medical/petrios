import { NextRequest, NextResponse } from 'next/server'
import { notifyUser } from '@/lib/notify'
import { opsEnabled } from '@/lib/ops/flags'
import { startRun } from '@/lib/ops/run'
import { runSynthesisForSession } from '@/lib/ops/synthesis'
import { draftThankYouEmail } from '@/lib/ops/drafts'
import { buildOpsEmailHtml } from '@/lib/ops/email-html'
import { profileDisplayName } from '@/lib/contacts'
import * as opsDb from '@/lib/db/ops'
import * as opsReads from '@/lib/db/ops-reads'
import * as auditDb from '@/lib/db/audit'
import * as feedbackDb from '@/lib/db/feedback'
import * as sessionsDb from '@/lib/db/sessions'
import * as onboardingDb from '@/lib/db/onboarding'

/**
 * Post-session synthesis pass. For sessions that ended 2–45 days ago, have
 * feedback, and no synthesis yet (UNIQUE(session_id) makes reruns
 * idempotent):
 *   - synthesise feedback into a safety-railed artifact
 *   - welfare-flagged sessions notify moderators to read the RAW feedback —
 *     no themes, no thank-you drafted from it
 *   - otherwise draft a thank-you-with-insights email per accepted teacher,
 *     queued as a pending action for approval
 *
 * The 2-day floor lets the feedback window close; syntheses are ready before
 * the Monday newsletter covers the prior week. Cap 5 sessions per run.
 * Run daily: GET /api/cron/ops-synthesis?secret=CRON_SECRET
 */

const SYNTHESIS_CAP = 5

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!opsEnabled()) {
    return NextResponse.json({ message: 'Bytes Ops is disabled', skipped: true })
  }

  const run = await startRun('ops_synthesis', 'cron')
  try {
    const candidates = await opsReads.listSessionsEndedBetween(2, 45)
    const synthesized = await opsDb.listSynthesizedSessionIds(candidates.map((s) => s.id))
    const unsynthesized = candidates.filter((s) => !synthesized.has(s.id))

    // Only sessions that actually received feedback.
    const ratings = await auditDb.listFeedbackRatingsForSessions(unsynthesized.map((s) => s.id))
    const withFeedback = unsynthesized.filter((s) =>
      ratings.some((r) => r.session_id === s.id)
    )
    const batch = withFeedback.slice(0, SYNTHESIS_CAP)
    await run.log('synthesis:scan', {
      candidates: candidates.length,
      withFeedback: withFeedback.length,
      processing: batch.length,
    })

    let processed = 0
    let drafted = 0
    for (const session of batch) {
      const synthesis = await runSynthesisForSession(session, run)
      if (!synthesis) continue
      processed++

      if (synthesis.requires_human_review) {
        const moderators = await opsReads.listDepartmentModeratorUserIds(session.department_id)
        for (const moderator of moderators) {
          await notifyUser({
            orgId: session.org_id,
            userId: moderator,
            notification: {
              type: 'OPS_FEEDBACK_REVIEW',
              title: `Feedback needs human review: "${session.title}"`,
              body: 'Some responses may raise welfare or conduct concerns. Please read the raw feedback directly.',
              link: `/sessions/${session.id}/manage`,
            },
          })
        }
        continue // never draft automated thank-yous off flagged feedback
      }

      // Thank-you drafts for everyone who actually taught (accepted only).
      // Drafted exactly once: only in the same pass that created the synthesis.
      const dateStr = new Date(session.date_start).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })

      const [teacherIds, externalTeachers] = await Promise.all([
        sessionsDb.listAcceptedSessionTeacherUserIdsAsSystem(session.id),
        feedbackDb.listAcceptedTeacherInvitations(session.id),
      ])
      const profiles = await onboardingDb.listProfilesForUsers(teacherIds)

      const recipients: { name: string; email: string }[] = []
      for (const profile of profiles) {
        if (!profile.email) continue
        recipients.push({ name: profileDisplayName(profile, profile.email), email: profile.email })
      }
      const registeredEmails = new Set(recipients.map((r) => r.email.toLowerCase()))
      for (const external of externalTeachers) {
        if (!external.email || registeredEmails.has(external.email.toLowerCase())) continue
        const name =
          [external.first_name, external.last_name].filter(Boolean).join(' ') || external.email
        recipients.push({ name, email: external.email })
      }

      for (const recipient of recipients) {
        const draft = await draftThankYouEmail(
          {
            recipientName: recipient.name,
            sessionTitle: session.title,
            dateLabel: dateStr,
            synthesis,
          },
          run
        )
        await opsDb.insertPendingAction({
          orgId: session.org_id,
          departmentId: session.department_id,
          type: 'THANK_YOU_EMAIL',
          payload: {
            sessionId: session.id,
            email: recipient.email,
            subject: draft.subject,
            html: buildOpsEmailHtml({ heading: draft.subject, bodyText: draft.body }),
          },
          previewTitle: `Thank ${recipient.name} — "${session.title}"`,
          previewBody: `To: ${recipient.email}\nSubject: ${draft.subject}\n\n${draft.body}`,
        })
        drafted++
      }
    }

    const summary = `${processed} session(s) synthesised, ${drafted} thank-you draft(s)`
    await run.finish('succeeded', summary)
    return NextResponse.json({ message: summary, processed, drafted })
  } catch (err) {
    console.error('ops-synthesis failed:', err)
    await run.finish('failed', err instanceof Error ? err.message : 'unknown error')
    return NextResponse.json({ error: 'ops-synthesis failed' }, { status: 500 })
  }
}
