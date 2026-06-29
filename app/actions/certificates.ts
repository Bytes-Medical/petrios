'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOrg } from '@/lib/auth'
import type { CertificateRole } from '@/lib/types'
import { generateCertificatePDF } from '@/lib/certificates/pdf'
import { generateCertificateCode } from '@/lib/certificates/utils'
import { createSupabaseClient } from '@/lib/supabase/server'
import * as certificatesDb from '@/lib/db/certificates'
import { DbNotFoundError } from '@/lib/db'

export async function generateCertificate(
  sessionId: string,
  userId: string,
  role: CertificateRole
) {
  await requireAuth()
  const orgId = await requireOrg()

  const session = await certificatesDb.findSessionForCertificate(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  // Auth-plane: the current user is the moderator generating this certificate.
  // Stays on a direct Supabase client until the auth provider is swapped.
  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()

  // Snapshot the issuing moderator so verification can show who certified it,
  // even if their account/name changes later.
  const issuerName =
    userData?.user?.user_metadata?.full_name || userData?.user?.email || null
  const issuedBy = userData?.user?.id || null

  const certificateCode = generateCertificateCode()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const verifyUrl = `${baseUrl}/verify/${certificateCode}`

  const pdfBuffer = await generateCertificatePDF({
    orgName: session.organizations?.name || 'Organization',
    departmentName: session.departments?.name || 'Unknown',
    sessionTitle: session.title,
    sessionDate: new Date(session.date_start).toLocaleDateString(),
    recipientName: userData?.user?.email || userId,
    role: role === 'ATTENDEE' ? 'Attendee' : 'Teacher',
    certificateCode,
    issuedDate: new Date().toLocaleDateString(),
    verifyUrl,
    leadName: session.departments?.lead_name || undefined,
    issuerName: issuerName || undefined,
  })

  const certificate = await certificatesDb.insertCertificate({
    orgId,
    departmentId: session.department_id,
    sessionId,
    userId,
    role,
    certificateCode,
    issuedBy,
    issuedByName: issuerName,
  })

  revalidatePath('/certificates')
  return { certificate, pdfBuffer }
}

export async function generateCertificatesForSession(sessionId: string) {
  await requireAuth()
  const orgId = await requireOrg()

  const session = await certificatesDb.findSessionForCertificate(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  const sessionEnd = new Date(session.date_end)
  const now = new Date()
  if (now < sessionEnd) {
    throw new Error('Cannot generate certificates before session ends')
  }

  if (session.status === 'CANCELLED') {
    throw new Error('Cannot generate certificates for cancelled sessions')
  }

  const teacherIds = await certificatesDb.listSessionTeacherIds(sessionId)
  const attendeeIds = await certificatesDb.listSessionAttendeeUserIds(sessionId)

  const results = []

  for (const teacherId of teacherIds) {
    try {
      const result = await generateCertificate(sessionId, teacherId, 'TEACHER')
      results.push(result)
    } catch (error) {
      console.error(`Failed to generate certificate for teacher ${teacherId}:`, error)
    }
  }

  for (const attendeeId of attendeeIds) {
    if (session.require_feedback_for_certificate) {
      const hasFeedback = await certificatesDb.hasUserSubmittedFeedback(sessionId, attendeeId)
      if (!hasFeedback) {
        console.log(
          `Skipping certificate for ${attendeeId} - feedback required but not submitted`
        )
        continue
      }
    }

    try {
      const result = await generateCertificate(sessionId, attendeeId, 'ATTENDEE')
      results.push(result)
    } catch (error) {
      console.error(`Failed to generate certificate for attendee ${attendeeId}:`, error)
    }
  }

  revalidatePath(`/sessions/${sessionId}`)
  return results
}

export async function getMyCertificates() {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  return certificatesDb.listMyCertificates(orgId, userId)
}

export async function getCertificateByCode(code: string) {
  return certificatesDb.findCertificateByCode(code)
}

export async function downloadMyCertificateForSession(sessionId: string) {
  const userId = await requireAuth()

  // Look up certificate record for this user + session (across all orgs)
  const certificate = await certificatesDb.findCertificateByUserAndSession(userId, sessionId)
  if (!certificate) {
    throw new DbNotFoundError('No certificate found for this session')
  }

  // Fetch session details for the PDF
  const session = await certificatesDb.findSessionForCertificateById(sessionId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()

  const recipientName =
    certificate.recipient_name ||
    userData?.user?.user_metadata?.full_name ||
    userData?.user?.email ||
    userId

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const verifyUrl = `${baseUrl}/verify/${certificate.certificate_code}`

  const pdfBuffer = await generateCertificatePDF({
    orgName: session.org_name || 'Organization',
    departmentName: session.department_name || 'Department',
    sessionTitle: session.title,
    sessionDate: new Date(session.date_start).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    recipientName,
    role: certificate.certificate_role === 'TEACHER' ? 'Teacher' : 'Attendee',
    certificateCode: certificate.certificate_code,
    issuedDate: new Date(certificate.issued_at).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    verifyUrl,
    leadName: session.lead_name || undefined,
    issuerName: certificate.issued_by_name || undefined,
  })

  // Return base64 for client-side download
  const base64 = Buffer.from(pdfBuffer).toString('base64')
  return { base64, filename: `certificate-${session.title.replace(/\s+/g, '-').toLowerCase()}.pdf` }
}
