'use server'

import { requireAuth, requireOrg } from '@/lib/auth'
import { getAppUrl } from '@/lib/app-url'
import {
  isFederationConfigured,
  getInstancePublicKey,
  signPayload,
  splitRecord,
  verifyPayload,
  TEACHING_RECORD_FORMAT,
  type TeachingRecord,
} from '@/lib/federation'
import { getMyPassport } from './portfolio'
import { profileDisplayName } from '@/lib/contacts'
import * as onboardingDb from '@/lib/db/onboarding'

/**
 * Federation actions: export MY teaching record as a signed portable JSON
 * document, and verify records issued by any instance. Export is
 * self-scoped; verification is public-safe (no auth-derived data).
 */

export async function exportTeachingRecord(): Promise<{ json: string; filename: string }> {
  const userId = await requireAuth()
  await requireOrg()

  if (!isFederationConfigured()) {
    throw new Error(
      'Federation is not enabled on this instance (INSTANCE_SIGNING_KEY is not set — ask your administrator).'
    )
  }

  const [passport, profile] = await Promise.all([
    getMyPassport(),
    onboardingDb.findProfileByUserId(userId),
  ])

  const payload = {
    format: TEACHING_RECORD_FORMAT,
    issuer: getAppUrl(),
    issued_at: new Date().toISOString(),
    public_key: getInstancePublicKey(),
    subject: {
      name: profile ? profileDisplayName(profile, profile.email) : 'Member',
      grade: profile?.grade ?? null,
    },
    attendance: passport.attendance.entries.map((entry) => ({
      session: entry.session_title,
      date: entry.session_date,
      status: entry.status,
      source: entry.primary_source,
    })),
    certificates: passport.certificates.map((c) => c.certificate_code),
    coverage: passport.coverage.map((c) => ({ domain: c.name, sessions: c.sessionCount })),
  }

  const record: TeachingRecord = { ...payload, signature: signPayload(payload) } as TeachingRecord

  return {
    json: JSON.stringify(record, null, 2),
    filename: `teaching-record-${new Date().toISOString().slice(0, 10)}.json`,
  }
}

export interface RecordVerification {
  valid: boolean
  reason?: string
  issuer?: string
  issuedAt?: string
  subjectName?: string
  attendanceCount?: number
  certificates?: string[]
  issuerKeyConfirmed?: boolean | null
}

export async function verifyTeachingRecord(json: string): Promise<RecordVerification> {
  let record: TeachingRecord
  try {
    record = JSON.parse(json)
  } catch {
    return { valid: false, reason: 'Not valid JSON' }
  }

  if (record?.format !== TEACHING_RECORD_FORMAT) {
    return { valid: false, reason: `Unknown record format (expected ${TEACHING_RECORD_FORMAT})` }
  }
  if (!record.signature || !record.public_key) {
    return { valid: false, reason: 'Record is missing its signature or public key' }
  }

  const { payload, signature } = splitRecord(record)
  if (!verifyPayload(payload, signature, record.public_key)) {
    return { valid: false, reason: 'Signature verification failed — the record was altered or forged' }
  }

  // Cross-check the embedded key against the issuer's live well-known
  // identity (best-effort; offline verification is still meaningful).
  let issuerKeyConfirmed: boolean | null = null
  try {
    const response = await fetch(`${record.issuer}/.well-known/petrios`, {
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      const wellKnown = (await response.json()) as { public_key?: string }
      issuerKeyConfirmed = wellKnown.public_key === record.public_key
    }
  } catch {
    issuerKeyConfirmed = null
  }

  return {
    valid: true,
    issuer: record.issuer,
    issuedAt: record.issued_at,
    subjectName: record.subject?.name,
    attendanceCount: record.attendance?.length ?? 0,
    certificates: record.certificates ?? [],
    issuerKeyConfirmed,
  }
}
