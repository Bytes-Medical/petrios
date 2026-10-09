import { createHmac, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  base64UrlEncode,
  importRsaSigningKey,
  looksLikeRsaPrivateKeyDer,
  MeetingKeyError,
  pemToDer,
  pkcs1ToPkcs8,
  signJwtHs256,
  signJwtRs256,
} from './jwt'
import { normalizePrivateKeyPem } from './config'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PKCS8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PKCS1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const SPKI_DER = publicKey.export({ type: 'spki', format: 'der' })

function base64UrlDecode(part: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(part, 'base64url'))
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

async function verifyRs256(token: string, spkiDer: Buffer): Promise<boolean> {
  const [header, payload, signature] = token.split('.')
  const key = await crypto.subtle.importKey(
    'spki',
    new Uint8Array(spkiDer),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(signature),
    new TextEncoder().encode(`${header}.${payload}`)
  )
}

const HEADER = { alg: 'RS256', typ: 'JWT', kid: 'vpaas-magic-cookie-abc/123' }
const PAYLOAD = { aud: 'jitsi', iss: 'chat', sub: 'vpaas-magic-cookie-abc', room: 'petrios-x', exp: 2_000_000_000 }

describe('base64UrlEncode', () => {
  it('is unpadded base64url and round-trips bytes and UTF-8 text', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    const encoded = base64UrlEncode(bytes)
    expect(encoded).not.toMatch(/[=+/]/)
    expect(Array.from(base64UrlDecode(encoded))).toEqual(Array.from(bytes))
    expect(base64UrlEncode('Dr Siân Ó’Brien')).toBe(Buffer.from('Dr Siân Ó’Brien').toString('base64url'))
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
  })

  it('handles inputs larger than one conversion chunk', () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 31) & 0xff)
    expect(base64UrlEncode(big)).toBe(Buffer.from(big).toString('base64url'))
  })
})

describe('PKCS#1 → PKCS#8', () => {
  it('wraps a PKCS#1 key into the exact DER Node exports as PKCS#8', () => {
    const wrapped = pkcs1ToPkcs8(pemToDer(PKCS1))
    const expected = new Uint8Array(privateKey.export({ type: 'pkcs8', format: 'der' }))
    expect(Buffer.from(wrapped).equals(Buffer.from(expected))).toBe(true)
    expect(Buffer.from(pemToDer(PKCS8)).equals(Buffer.from(expected))).toBe(true)
  })

  // 4096-bit is what the JaaS console and `openssl genrsa 4096` usually hand
  // out; its OCTET STRING and outer SEQUENCE lengths differ from 2048-bit.
  it.each([1024, 3072, 4096])(
    'wraps a real %i-bit PKCS#1 key byte-for-byte and signs with it (incl. literal \\n escapes)',
    async (modulusLength) => {
      const pair = generateKeyPairSync('rsa', { modulusLength })
      const pkcs1Pem = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
      const expected = pair.privateKey.export({ type: 'pkcs8', format: 'der' })
      const wrapped = pkcs1ToPkcs8(pemToDer(pkcs1Pem))
      expect(Buffer.from(wrapped).equals(Buffer.from(expected))).toBe(true)
      expect(looksLikeRsaPrivateKeyDer(pemToDer(pkcs1Pem), 'pkcs1')).toBe(true)
      expect(looksLikeRsaPrivateKeyDer(wrapped, 'pkcs8')).toBe(true)

      // As pasted into a single-line env var / Worker secret, then normalised
      // exactly as lib/meeting/token.ts does before signing.
      const oneLine = pkcs1Pem.trim().replace(/\n/g, '\\n')
      const normalized = normalizePrivateKeyPem(oneLine)
      expect(normalized).not.toBeNull()
      const token = await signJwtRs256(HEADER, PAYLOAD, normalized!.pem)
      expect(await verifyRs256(token, pair.publicKey.export({ type: 'spki', format: 'der' }))).toBe(true)
    },
    30_000
  )

  it('encodes short and long DER lengths', () => {
    const short = pkcs1ToPkcs8(new Uint8Array(10))
    expect(Array.from(short.subarray(0, 2))).toEqual([0x30, 3 + 15 + 2 + 10])
    const long = pkcs1ToPkcs8(new Uint8Array(300))
    // OCTET STRING of 300 bytes: 04 82 01 2c
    expect(Array.from(long.subarray(long.length - 304, long.length - 300))).toEqual([0x04, 0x82, 0x01, 0x2c])
  })

  it('recognises RSA key shapes and rejects others', () => {
    expect(looksLikeRsaPrivateKeyDer(pemToDer(PKCS8), 'pkcs8')).toBe(true)
    expect(looksLikeRsaPrivateKeyDer(pemToDer(PKCS1), 'pkcs1')).toBe(true)
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'der' })
    expect(looksLikeRsaPrivateKeyDer(new Uint8Array(ec), 'pkcs8')).toBe(false)
    expect(looksLikeRsaPrivateKeyDer(pemToDer(PKCS8).subarray(0, 100), 'pkcs8')).toBe(false)
    expect(looksLikeRsaPrivateKeyDer(new Uint8Array([0x30, 0x00]), 'pkcs1')).toBe(false)
  })
})

describe('signJwtRs256', () => {
  it('produces a token that verifies with the matching public key (PKCS#8 PEM)', async () => {
    const token = await signJwtRs256(HEADER, PAYLOAD, PKCS8)
    const [header, payload] = token.split('.')
    expect(decodeJson(header)).toEqual({ alg: 'RS256', typ: 'JWT', kid: HEADER.kid })
    expect(decodeJson(payload)).toEqual(PAYLOAD)
    expect(await verifyRs256(token, SPKI_DER)).toBe(true)
  })

  it('signs with a PKCS#1 PEM ("BEGIN RSA PRIVATE KEY")', async () => {
    const token = await signJwtRs256(HEADER, PAYLOAD, PKCS1)
    expect(await verifyRs256(token, SPKI_DER)).toBe(true)
  })

  it('does not verify with a different key or a tampered payload', async () => {
    const token = await signJwtRs256(HEADER, PAYLOAD, PKCS8)
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' })
    expect(await verifyRs256(token, other)).toBe(false)
    const [h, , s] = token.split('.')
    const forged = `${h}.${base64UrlEncode(JSON.stringify({ ...PAYLOAD, room: '*' }))}.${s}`
    expect(await verifyRs256(forged, SPKI_DER)).toBe(false)
  })

  it('always declares RS256, whatever the caller passes', async () => {
    const token = await signJwtRs256({ alg: 'none', kid: 'k' }, PAYLOAD, PKCS8)
    expect(decodeJson(token.split('.')[0])).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: 'k' })
    expect(await verifyRs256(token, SPKI_DER)).toBe(true)
  })

  it('matches Node’s own RS256 signature byte for byte (deterministic PKCS#1 v1.5)', async () => {
    const token = await signJwtRs256(HEADER, PAYLOAD, PKCS8)
    const [h, p, s] = token.split('.')
    const { createSign } = await import('node:crypto')
    const nodeSignature = createSign('RSA-SHA256').update(`${h}.${p}`).sign(createPrivateKey(PKCS8)).toString('base64url')
    expect(s).toBe(nodeSignature)
    expect(createPublicKey(PKCS8).export({ type: 'spki', format: 'der' }).equals(SPKI_DER)).toBe(true)
  })

  it.each([
    ['an EC key', generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()],
    ['a public key', publicKey.export({ type: 'spki', format: 'pem' }).toString()],
    ['garbage', 'definitely-not-a-key'],
    ['a corrupted body', PKCS8.replace(/\n[A-Za-z0-9+/]{4}/, '\n!!!!')],
  ])('rejects %s with MeetingKeyError whose message excludes the key', async (_label, pem) => {
    const error = await signJwtRs256(HEADER, PAYLOAD, pem).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MeetingKeyError)
    expect((error as Error).message).not.toContain('MII')
    expect((error as Error).message).not.toContain(pem.length > 60 ? pem.slice(30, 60) : pem)
  })
})

describe('importRsaSigningKey', () => {
  it('reuses the imported key for the same PEM', async () => {
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n$/, '\n\n')
    const spy = vi.spyOn(globalThis.crypto.subtle, 'importKey')
    const first = await importRsaSigningKey(pem)
    const second = await importRsaSigningKey(pem)
    expect(second).toBe(first)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(first.extractable).toBe(false)
    expect(first.usages).toEqual(['sign'])
    spy.mockRestore()
  })

  it('evicts a failed import so a later call retries', async () => {
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() + '\n\n\n'
    const spy = vi.spyOn(globalThis.crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('transient'))
    await expect(importRsaSigningKey(pem)).rejects.toBeInstanceOf(MeetingKeyError)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(importRsaSigningKey(pem)).resolves.toBeDefined()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})

describe('signJwtHs256', () => {
  it('equals an HMAC-SHA256 over header.payload with the shared secret', async () => {
    const secret = 'prosody-app-secret'
    const token = await signJwtHs256({ typ: 'JWT' }, PAYLOAD, secret)
    const [h, p, s] = token.split('.')
    expect(decodeJson(h)).toEqual({ typ: 'JWT', alg: 'HS256' })
    expect(s).toBe(createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'))
    expect(createHmac('sha256', 'other-secret').update(`${h}.${p}`).digest('base64url')).not.toBe(s)
  })

  it('refuses an empty secret', async () => {
    await expect(signJwtHs256({}, PAYLOAD, '')).rejects.toBeInstanceOf(MeetingKeyError)
  })
})
