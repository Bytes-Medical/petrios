'use server'

import { createSupabaseClient } from '@/lib/supabase/server'
import { requireAuth, requireOrg, getCurrentUserId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { CertificateRole } from '@/lib/types'
import { generateCertificatePDF } from '@/lib/certificates/pdf'

export async function generateCertificate(
  sessionId: string,
  userId: string,
  role: CertificateRole
) {
  await requireAuth()
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  // Get session and related data
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select(`
      *,
      departments:department_id (id, name),
      organizations:org_id (id, name),
      session_teachers (user_id)
    `)
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (sessionError || !session) {
    throw new Error('Session not found')
  }

  // Get user info
  const { data: userData } = await supabase.auth.getUser()
  const certificateCode = generateCertificateCode()

  // Generate verification URL (assuming the app is hosted, adjust domain as needed)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const verifyUrl = `${baseUrl}/verify/${certificateCode}`

  // Generate PDF
  const pdfBuffer = await generateCertificatePDF({
    orgName: (session.organizations as any)?.name || 'Organization',
    departmentName: (session.departments as any)?.name || 'Unknown',
    sessionTitle: session.title,
    sessionDate: new Date(session.date_start).toLocaleDateString(),
    recipientName: userData?.user?.email || userId,
    role: role === 'ATTENDEE' ? 'Attendee' : 'Teacher',
    certificateCode,
    issuedDate: new Date().toLocaleDateString(),
    verifyUrl,
  })

  // Store certificate
  const { data: certificate, error: certError } = await supabase
    .from('certificates')
    .insert({
      org_id: orgId,
      department_id: session.department_id,
      session_id: sessionId,
      user_id: userId,
      certificate_role: role,
      certificate_code: certificateCode,
    })
    .select()
    .single()

  if (certError) {
    throw new Error(`Failed to create certificate: ${certError.message}`)
  }

  revalidatePath('/certificates')
  return { certificate, pdfBuffer }
}

export async function generateCertificatesForSession(sessionId: string) {
  await requireAuth()
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  // Get session
  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  // Get teachers
  const { data: teachers } = await supabase
    .from('session_teachers')
    .select('user_id')
    .eq('session_id', sessionId)

  // Get attendees (present or late) - session must be completed
  const sessionEnd = new Date(session.date_end)
  const now = new Date()
  if (now < sessionEnd) {
    throw new Error('Cannot generate certificates before session ends')
  }

  if (session.status === 'CANCELLED') {
    throw new Error('Cannot generate certificates for cancelled sessions')
  }

  // Get attendees (present or late)
  const { data: attendees } = await supabase
    .from('attendance')
    .select('user_id')
    .eq('session_id', sessionId)
    .in('status', ['PRESENT', 'LATE'])

  const results = []

  // Generate for teachers
  if (teachers) {
    for (const teacher of teachers) {
      try {
        const result = await generateCertificate(sessionId, teacher.user_id, 'TEACHER')
        results.push(result)
      } catch (error) {
        console.error(`Failed to generate certificate for teacher ${teacher.user_id}:`, error)
      }
    }
  }

  // Generate for attendees
  if (attendees) {
    for (const attendee of attendees) {
      // Check if feedback is required
      if (session.require_feedback_for_certificate) {
        const { data: feedback } = await supabase
          .from('session_feedback')
          .select('id')
          .eq('session_id', sessionId)
          .eq('user_id', attendee.user_id)
          .single()

        if (!feedback) {
          console.log(`Skipping certificate for ${attendee.user_id} - feedback required but not submitted`)
          continue
        }
      }

      try {
        const result = await generateCertificate(sessionId, attendee.user_id, 'ATTENDEE')
        results.push(result)
      } catch (error) {
        console.error(`Failed to generate certificate for attendee ${attendee.user_id}:`, error)
      }
    }
  }

  revalidatePath(`/sessions/${sessionId}`)
  return results
}

export async function getMyCertificates() {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('certificates')
    .select(`
      *,
      sessions:session_id (id, title, date_start),
      departments:department_id (id, name)
    `)
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('issued_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch certificates: ${error.message}`)
  }

  return data || []
}

export async function getCertificateByCode(code: string) {
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('certificates')
    .select(`
      *,
      sessions:session_id (id, title, date_start, description),
      departments:department_id (id, name)
    `)
    .eq('certificate_code', code)
    .single()

  if (error || !data) {
    return null
  }

  return data
}

function generateCertificateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}
