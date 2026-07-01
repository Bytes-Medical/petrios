import { NextRequest, NextResponse } from 'next/server'
import { generateCertificateCode } from '@/lib/certificates/utils'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildCertificateEmailHtml } from '@/lib/email-templates'
import { computeAttendanceFromEvidence } from '@/lib/attendance/compute'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import * as certificatesDb from '@/lib/db/certificates'
import * as onboardingDb from '@/lib/db/onboarding'

export async function GET(request: NextRequest) {
  // Auth: check secret token
  const secret = request.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessions = await sessionsDb.listSessionsNeedingReport()

  if (sessions.length === 0) {
    return NextResponse.json({ message: 'No sessions to process', processed: 0 })
  }

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()

  let processedCount = 0

  for (const session of sessions) {
    try {
      // 1. Record TEACHER evidence for assigned teachers (idempotent)
      const teacherIds = await sessionsDb.listSessionTeacherIdsAsSystem(session.id)
      for (const teacherId of teacherIds) {
        const exists = await attendanceDb.evidenceExistsAsSystem({
          sessionId: session.id,
          userId: teacherId,
          source: 'TEACHER',
        })
        if (!exists) {
          await attendanceDb.insertAttendanceEvidenceAsSystem({
            orgId: session.org_id,
            sessionId: session.id,
            departmentId: session.department_id,
            userId: teacherId,
            source: 'TEACHER',
            observedAt: session.date_start,
            metadata: { assigned_as_teacher: true },
          })
        }
      }

      // 2. Recompute attendance with the same evidence semantics as the
      //    interactive pipeline (lib/attendance/compute). Locked sessions
      //    keep their existing computed rows.
      if (!session.attendance_locked) {
        const evidence = await attendanceDb.listSessionEvidenceAsSystem(session.id)

        const byAttendee = new Map<string, typeof evidence>()
        for (const ev of evidence) {
          const key = ev.user_id ? `u:${ev.user_id}` : ev.external_email ? `e:${ev.external_email}` : null
          if (!key) continue
          const list = byAttendee.get(key)
          if (list) list.push(ev)
          else byAttendee.set(key, [ev])
        }

        for (const [key, attendeeEvidence] of Array.from(byAttendee.entries())) {
          const isUserId = key.startsWith('u:')
          const identifier = key.slice(2)
          const computed = computeAttendanceFromEvidence(attendeeEvidence, session)

          await attendanceDb.upsertAttendance({
            orgId: session.org_id,
            sessionId: session.id,
            departmentId: session.department_id,
            userId: isUserId ? identifier : null,
            externalEmail: isUserId ? null : identifier,
            status: computed.status,
            primarySource: computed.primarySource,
            firstEvidenceAt: computed.firstEvidenceAt,
          })
        }
      }

      // 3. Attendees who were actually there (LATE still attended)
      const attendeeIds = await attendanceDb.listAttendeeUserIdsByStatusAsSystem(
        session.id,
        ['PRESENT', 'LATE']
      )

      if (attendeeIds.length === 0) {
        await sessionsDb.markSessionReportSent(session.id)
        processedCount++
        continue
      }

      const profiles = await onboardingDb.listProfilesForUsers(attendeeIds)
      const profileByUserId = new Map(profiles.map((p) => [p.user_id, p]))

      // 4. Issue certificates and email each attendee
      for (const attendeeId of attendeeIds) {
        try {
          const profile = profileByUserId.get(attendeeId)
          if (!profile?.email) continue

          const recipientName =
            profile.full_name ||
            [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
            profile.email

          const existingCert = await certificatesDb.findCertificateByUserAndSession(
            attendeeId,
            session.id
          )

          if (!existingCert) {
            await certificatesDb.insertCertificateAsSystem({
              orgId: session.org_id,
              departmentId: session.department_id,
              sessionId: session.id,
              userId: attendeeId,
              role: 'ATTENDEE',
              certificateCode: generateCertificateCode(),
              recipientName,
            })
          }

          const html = buildCertificateEmailHtml(session.title, recipientName)

          await mailer.emails.send({
            from: fromAddress,
            to: profile.email,
            subject: `Your Attendance Certificate — ${session.title}`,
            html,
          })
        } catch (err) {
          console.error(`Failed to send report to attendee ${attendeeId}:`, err)
        }
      }

      // 5. Mark session as processed
      await sessionsDb.markSessionReportSent(session.id)
      processedCount++
    } catch (err) {
      console.error(`Failed to process session ${session.id}:`, err)
    }
  }

  return NextResponse.json({
    message: `Processed ${processedCount} of ${sessions.length} sessions`,
    processed: processedCount,
    total: sessions.length,
  })
}
