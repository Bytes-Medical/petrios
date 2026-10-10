import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { rotaBatchDigest, rotaKeyHmac, rotaPreviewRowProof } from './identity'

describe('rotaKeyHmac', () => {
  const secret = new TextEncoder().encode('s'.repeat(32))

  it('matches the documented construction', () => {
    const expected = createHmac('sha256', Buffer.from('s'.repeat(32)))
      .update('petrios-rota-id/v1|org-1|STAFF_ID|12345678')
      .digest('hex')
    expect(rotaKeyHmac(secret, 'org-1', 'STAFF_ID', '12345678')).toBe(expected)
    expect(rotaKeyHmac(secret, 'org-1', 'STAFF_ID', '12345678')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('separates organisations and key types', () => {
    const a = rotaKeyHmac(secret, 'org-1', 'EMAIL', 'a@b.test')
    expect(rotaKeyHmac(secret, 'org-2', 'EMAIL', 'a@b.test')).not.toBe(a)
    expect(rotaKeyHmac(secret, 'org-1', 'STAFF_ID', 'a@b.test')).not.toBe(a)
  })
})

describe('rotaPreviewRowProof', () => {
  const secret = new TextEncoder().encode('s'.repeat(32))
  const scope = { orgId: 'org-1', departmentId: 'dept-1', uploadId: 'up-1', callerUserId: 'user-1' }

  it('matches the documented construction (first 32 hex characters)', () => {
    const expected = createHmac('sha256', Buffer.from('s'.repeat(32)))
      .update('petrios-rota-preview/v1|org-1|dept-1|up-1|user-1|r3|12345678|a@b.test')
      .digest('hex')
      .slice(0, 32)
    expect(rotaPreviewRowProof(secret, scope, { ref: 'r3', staffKey: '12345678', email: 'a@b.test' })).toBe(expected)
  })

  it('binds the upload, the caller and every identifier', () => {
    const base = rotaPreviewRowProof(secret, scope, { ref: 'r3', staffKey: '1' })
    expect(rotaPreviewRowProof(secret, { ...scope, uploadId: 'up-2' }, { ref: 'r3', staffKey: '1' })).not.toBe(base)
    expect(rotaPreviewRowProof(secret, { ...scope, callerUserId: 'user-2' }, { ref: 'r3', staffKey: '1' })).not.toBe(base)
    expect(rotaPreviewRowProof(secret, scope, { ref: 'r3', staffKey: '2' })).not.toBe(base)
    expect(rotaPreviewRowProof(secret, scope, { ref: 'r3', staffKey: '1', email: 'x@y.test' })).not.toBe(base)
    expect(rotaPreviewRowProof(secret, scope, { ref: 'r4', staffKey: '1' })).not.toBe(base)
  })
})

describe('rotaBatchDigest', () => {
  it('is a keyed, org-scoped digest of the batch hash', () => {
    const secret = new TextEncoder().encode('s'.repeat(32))
    const sha = 'a'.repeat(64)
    const expected = createHmac('sha256', Buffer.from('s'.repeat(32))).update(`petrios-rota-batch/v1|org-1|${sha}`).digest('hex')
    expect(rotaBatchDigest(secret, 'org-1', sha)).toBe(expected)
    expect(rotaBatchDigest(secret, 'org-2', sha)).not.toBe(expected)
    expect(rotaBatchDigest(new TextEncoder().encode('t'.repeat(32)), 'org-1', sha)).not.toBe(expected)
  })
})
