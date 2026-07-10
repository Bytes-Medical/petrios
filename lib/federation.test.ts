import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import {
  canonicalize,
  getInstancePublicKey,
  signPayload,
  splitRecord,
  verifyPayload,
  type TeachingRecord,
} from './federation'

describe('canonicalize', () => {
  it('sorts object keys recursively and is whitespace-free', () => {
    expect(canonicalize({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } })).toBe(
      '{"a":{"c":3,"d":[2,{"y":2,"z":1}]},"b":1}'
    )
  })

  it('is stable regardless of key insertion order', () => {
    expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }))
  })

  it('drops undefined values and keeps null', () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}')
  })
})

describe('sign/verify roundtrip', () => {
  const original = process.env.INSTANCE_SIGNING_KEY

  beforeAll(() => {
    const { privateKey } = generateKeyPairSync('ed25519')
    process.env.INSTANCE_SIGNING_KEY = privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64')
  })

  afterAll(() => {
    if (original === undefined) delete process.env.INSTANCE_SIGNING_KEY
    else process.env.INSTANCE_SIGNING_KEY = original
  })

  it('verifies a signed payload with the derived public key', () => {
    const payload = { format: 'bytes-teaching-record/v1', subject: { name: 'A' } }
    const signature = signPayload(payload)
    expect(verifyPayload(payload, signature, getInstancePublicKey())).toBe(true)
  })

  it('rejects tampered payloads and wrong keys', () => {
    const payload = { a: 1 }
    const signature = signPayload(payload)
    expect(verifyPayload({ a: 2 }, signature, getInstancePublicKey())).toBe(false)

    const { publicKey: otherPub } = generateKeyPairSync('ed25519')
    const otherKeyB64 = otherPub.export({ format: 'der', type: 'spki' }).toString('base64')
    expect(verifyPayload(payload, signature, otherKeyB64)).toBe(false)
    expect(verifyPayload(payload, 'garbage', getInstancePublicKey())).toBe(false)
  })

  it('splitRecord separates the signature from the signed payload', () => {
    const record = {
      format: 'bytes-teaching-record/v1',
      issuer: 'https://x',
      issued_at: 'now',
      public_key: 'k',
      subject: { name: 'A', grade: null },
      attendance: [],
      certificates: [],
      coverage: [],
      signature: 'sig',
    } as TeachingRecord
    const { payload, signature } = splitRecord(record)
    expect(signature).toBe('sig')
    expect('signature' in payload).toBe(false)
    expect(payload.issuer).toBe('https://x')
  })
})
