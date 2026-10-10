import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// app/actions/rota-upload.ts over a mocked DAL and guard: the membership
// oracle bound (preview required, uploader rows need their preview proof) and
// the coordinator-safe summary (spec/14).

const SECRET = 'k'.repeat(40)
const ORG = '00000000-0000-4000-8000-0000000000a1'
const DEPT = '00000000-0000-4000-8000-0000000000d1'
const CALLER = '00000000-0000-4000-8000-0000000000c1'
const TRAINEE = '00000000-0000-4000-8000-0000000000e1'
const UPLOAD = '00000000-0000-4000-8000-0000000000f1'
const BATCH = '00000000-0000-4000-8000-0000000000b1'

const state = vi.hoisted(() => ({
  role: 'UPLOADER' as 'UPLOADER' | 'MODERATOR',
  hasPreview: true,
  previewOutcome: 'recorded' as 'recorded' | 'duplicate' | 'rate_limited',
  ingestCalls: 0,
}))

vi.mock('@/lib/rota/access', () => {
  class RotaAccessError extends Error {
    code: 'unavailable' | 'forbidden'
    constructor(code: 'unavailable' | 'forbidden') {
      super(code)
      this.code = code
    }
  }
  return {
    RotaAccessError,
    ROTA_RPC_MESSAGES: {
      invalid_payload: 'The upload could not be read. Reload the page and try again.',
      preview_required: 'Check matches for this upload first. Reload the page to start a new upload.',
    },
    requireRotaUploaderOrModerator: async () => ({ orgId: ORG, userId: CALLER, role: state.role }),
    getRotaAvailability: async () => ({ available: true, orgId: ORG, departmentId: DEPT, retentionDays: 30, horizonDays: 56 }),
    toRotaFailure: (error: unknown) => ({ ok: false, message: String((error as Error)?.message ?? error) }),
  }
})

vi.mock('@/lib/db/rota', async () => {
  const { rotaKeyHmac } = await import('./identity')
  return {
    recordMatchPreview: async () => state.previewOutcome,
    hasMatchPreview: async () => state.hasPreview,
    listUploadProfiles: async () => [],
    listDepartmentTrainees: async () => [{ userId: TRAINEE, email: '', displayName: 'Trainee One' }],
    findLinksByHmac: async () => [
      { keyType: 'STAFF_ID', keyHmac: rotaKeyHmac(new TextEncoder().encode(SECRET), ORG, 'STAFF_ID', 'S1'), userId: TRAINEE },
    ],
    listRotaCandidateSessions: async () => [],
    findLatestBatch: async () => null,
    ingestBatch: async () => {
      state.ingestCalls++
      return {
        batchId: BATCH,
        replayed: false,
        flagsInserted: 1,
        flagsReplaced: 0,
        flagsDeleted: 2,
        decidedMarkedChanged: 1,
        decidedUnmarked: 0,
        linksUpserted: 0,
        linksRefused: 0,
        rowsRejected: 0,
        sessionsAnnotated: 3,
      }
    },
  }
})

const { previewRotaMatches, submitRotaUpload } = await import('@/app/actions/rota-upload')
const { appDayKey } = await import('@/lib/datetime')
const { addDaysToKey } = await import('./schema')
const { canonicalRotaJson, sha256Hex } = await import('./canonical')

function batch() {
  const today = appDayKey()
  return {
    v: 1 as const,
    batch_id: BATCH,
    kind: 'PLANNED' as const,
    range: { from: today, to: addDaysToKey(today, 1) },
    templates: { l: [['00:00', '24:00', 'L'] as ['00:00', '24:00', 'L']] },
    people: [{ ref: 'r0', staff_key: 'S1', days: 'll' }],
  }
}

async function submit(extra: { proofs?: Record<string, string> } = {}) {
  const b = batch()
  return submitRotaUpload({
    departmentId: DEPT,
    uploadId: UPLOAD,
    profileId: null,
    payloadSha256: await sha256Hex(canonicalRotaJson(b)),
    batch: b,
    ...extra,
  })
}

beforeEach(() => {
  vi.stubEnv('ROTA_IDENTITY_SECRET', SECRET)
  vi.stubEnv('APP_TIME_ZONE', 'Europe/London')
  state.role = 'UPLOADER'
  state.hasPreview = true
  state.previewOutcome = 'recorded'
  state.ingestCalls = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('previewRotaMatches', () => {
  it('returns booleans plus a proof for each matched row to an uploader', async () => {
    const result = await previewRotaMatches({
      departmentId: DEPT,
      uploadId: UPLOAD,
      people: [
        { ref: 'r0', staffKey: 'S1' },
        { ref: 'r1', staffKey: 'S2' },
      ],
    })
    expect(result.ok && result.data.role === 'UPLOADER' && result.data.rows).toEqual([
      { ref: 'r0', matched: true, proof: expect.stringMatching(/^[0-9a-f]{32}$/) },
      { ref: 'r1', matched: false, proof: null },
    ])
  })

  it('reports the atomic daily limit', async () => {
    state.previewOutcome = 'rate_limited'
    const result = await previewRotaMatches({ departmentId: DEPT, uploadId: UPLOAD, people: [{ ref: 'r0', staffKey: 'S1' }] })
    expect(result).toMatchObject({ ok: false, code: 'rate_limited' })
  })
})

describe('submitRotaUpload', () => {
  it('refuses an upload whose match preview was never recorded', async () => {
    state.hasPreview = false
    expect(await submit()).toMatchObject({ ok: false, code: 'preview_required' })
    expect(state.ingestCalls).toBe(0)
  })

  it('refuses an uploader row without its preview proof, or with another row’s proof', async () => {
    expect(await submit()).toMatchObject({ ok: false, code: 'invalid_payload' })
    expect(await submit({ proofs: { r0: 'a'.repeat(32) } })).toMatchObject({ ok: false, code: 'invalid_payload' })
    expect(state.ingestCalls).toBe(0)
  })

  it('gives an uploader counts only, never flag or decision counts', async () => {
    const preview = await previewRotaMatches({ departmentId: DEPT, uploadId: UPLOAD, people: [{ ref: 'r0', staffKey: 'S1' }] })
    const proof = preview.ok && preview.data.role === 'UPLOADER' ? preview.data.rows[0].proof! : ''
    const result = await submit({ proofs: { r0: proof } })
    expect(result).toEqual({
      ok: true,
      data: {
        replayed: false,
        sessionsAnnotated: 3,
        peopleReceived: 1,
        matched: 1,
        unmatched: 0,
        conflicts: 0,
        newUnmatchedSinceLast: null,
        details: null,
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/flags|decided|rowsRejected|links/i)
  })

  it('gives a moderator the full counts without needing proofs', async () => {
    state.role = 'MODERATOR'
    const result = await submit()
    expect(result.ok && result.data.details).toMatchObject({ flagsInserted: 1, flagsDeleted: 2, decidedMarkedChanged: 1 })
  })
})
