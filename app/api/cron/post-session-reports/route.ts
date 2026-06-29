import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { generateCertificateCode } from '@/lib/certificates/utils'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildCertificateEmailHtml } from '@/lib/email-templates'
import * as sessionsDb from '@/lib/db/sessions'
import * as certificatesDb from '@/lib/db/certificates'

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

  const supabase = await createSupabaseServiceClient()
  const mailer = getEmailClient()
  const fromAddress = getFromAddress()

  let processedCount = 0

  for (const session of sessions) {
    try {
      // 1. Mark teachers as PRESENT (TEACHER evidence)
      const { data: teachers } = await supabase
        .from('session_teachers')
        .select('user_id')
        .eq('session_id', session.id)

      if (teachers) {
        for (const teacher of teachers) {
          // Check if evidence already exists
          const { data: existing } = await supabase
            .from('attendance_evidence')
            .select('id')
            .eq('session_id', session.id)
            .eq('user_id', teacher.user_id)
            .eq('source', 'TEACHER')
            .maybeSingle()

          if (!existing) {
            await supabase.from('attendance_evidence').insert({
              org_id: session.org_id,
              session_id: session.id,
              department_id: session.department_id,
              user_id: teacher.user_id,
              source: 'TEACHER',
              observed_at: session.date_start,
              metadata: { assigned_as_teacher: true },
            })
          }
        }
      }

      // 2. Recompute attendance for this session
      // Get all evidence and upsert attendance records
      const { data: evidence } = await supabase
        .from('attendance_evidence')
        .select('user_id, external_email, source, observed_at')
        .eq('session_id', session.id)

      if (evidence) {
        const userAttendance = new Map<string, { source: string; observedAt: string }>()

        const sourcePriority: Record<string, number> = {
          TEACHER: 5, TEAMS: 4, FEEDBACK: 3, GROUP_CODE: 2, SELF_CHECKIN: 1,
        }

        for (const e of evidence) {
          const key = e.user_id || e.external_email || ''
          if (!key) continue

          const existing = userAttendance.get(key)
          if (!existing || (sourcePriority[e.source] ?? 0) > (sourcePriority[existing.source] ?? 0)) {
            userAttendance.set(key, { source: e.source, observedAt: e.observed_at })
          }
        }

        for (const [key, att] of userAttendance.entries()) {
          const isUserId = !key.includes('@')
          const status = 'PRESENT'

          await supabase.from('attendance').upsert(
            {
              org_id: session.org_id,
              session_id: session.id,
              user_id: isUserId ? key : null,
              external_email: isUserId ? null : key,
              status,
              primary_source: att.source,
              first_evidence_at: att.observedAt,
              computed_at: new Date().toISOString(),
            },
            { onConflict: isUserId ? 'session_id,user_id' : 'session_id,external_email' }
          )
        }
      }

      // 3. Get attendees (registered users with PRESENT status)
      const { data: attendees } = await supabase
        .from('attendance')
        .select('user_id')
        .eq('session_id', session.id)
        .not('user_id', 'is', null)
        .eq('status', 'PRESENT')

      if (!attendees || attendees.length === 0) {
        await sessionsDb.markSessionReportSent(session.id)
        processedCount++
        continue
      }

      // 4. Get department + org names
      const { data: dept } = await supabase
        .from('departments')
        .select('name, lead_name')
        .eq('id', session.department_id)
        .single()

      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', session.org_id)
        .single()

      const sessionDate = new Date(session.date_start).toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })

      // 6. Send report to each attendee
      for (const attendee of attendees) {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email, full_name, first_name, last_name')
            .eq('user_id', attendee.user_id)
            .single()

          if (!profile?.email) continue

          const recipientName = profile.full_name ||
            [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
            profile.email

          // Generate certificate
          const certificateCode = generateCertificateCode()

          // Check if certificate already exists
          const existingCert = await certificatesDb.findCertificateByUserAndSession(
            attendee.user_id, session.id
          )

          if (!existingCert) {
            await supabase.from('certificates').insert({
              org_id: session.org_id,
              department_id: session.department_id,
              session_id: session.id,
              user_id: attendee.user_id,
              certificate_role: 'ATTENDEE',
              certificate_code: certificateCode,
              recipient_name: recipientName,
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
          console.error(`Failed to send report to attendee ${attendee.user_id}:`, err)
        }
      }

      // 7. Mark session as processed
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
