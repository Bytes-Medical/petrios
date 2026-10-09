/**
 * Minimal JWT signing for Petrios Meet room passes on WebCrypto
 * (globalThis.crypto.subtle), so the same code runs on Render (Node) and on
 * Cloudflare Workers. No jsonwebtoken, no node:crypto.
 *
 * Nothing here logs, and no error message ever contains key material.
 */

/** Unusable key or secret. The message never includes the key itself. */
export class MeetingKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeetingKeyError'
  }
}

const encoder = new TextEncoder()

function toBytes(input: Uint8Array | string): Uint8Array {
  return typeof input === 'string' ? encoder.encode(input) : input
}

/** Copy into a fresh ArrayBuffer-backed view (WebCrypto's BufferSource). */
function bufferOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

/** Unpadded base64url (RFC 7515 §2). */
export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = toBytes(input)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/

function base64Decode(body: string): Uint8Array {
  if (body.length === 0 || body.length % 4 !== 0 || !BASE64_BODY.test(body)) {
    throw new MeetingKeyError('The private key is not valid base64 PEM.')
  }
  let binary: string
  try {
    binary = atob(body)
  } catch {
    throw new MeetingKeyError('The private key is not valid base64 PEM.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** DER bytes of a PEM block: strips the BEGIN/END lines and all whitespace. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '')
  return base64Decode(body)
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length)
  const bytes: number[] = []
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff)
  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function derTlv(tag: number, value: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(tag), derLength(value.length), value)
}

/** INTEGER 0 (PrivateKeyInfo version). */
const PKCS8_VERSION = Uint8Array.of(0x02, 0x01, 0x00)
/** AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }. */
const RSA_ALGORITHM_IDENTIFIER = Uint8Array.of(
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
)
/** The rsaEncryption OID as encoded inside an AlgorithmIdentifier. */
const RSA_ENCRYPTION_OID = RSA_ALGORITHM_IDENTIFIER.subarray(2, 13)

/**
 * Wrap a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo, which is the only
 * private-key format WebCrypto imports:
 * SEQUENCE { INTEGER 0, SEQUENCE { rsaEncryption, NULL }, OCTET STRING { pkcs1 } }.
 */
export function pkcs1ToPkcs8(pkcs1Der: Uint8Array): Uint8Array {
  return derTlv(0x30, concat(PKCS8_VERSION, RSA_ALGORITHM_IDENTIFIER, derTlv(0x04, pkcs1Der)))
}

/** Read a DER TLV header at `offset`; null when it does not fit the buffer. */
function readTlvHeader(der: Uint8Array, offset: number): { tag: number; length: number; body: number } | null {
  if (offset + 2 > der.length) return null
  const tag = der[offset]
  const first = der[offset + 1]
  if (first < 0x80) return { tag, length: first, body: offset + 2 }
  const count = first & 0x7f
  if (count === 0 || count > 4 || offset + 2 + count > der.length) return null
  let length = 0
  for (let i = 0; i < count; i++) length = length * 256 + der[offset + 2 + i]
  return { tag, length, body: offset + 2 + count }
}

/**
 * Cheap synchronous shape check used by configuration resolution (which must
 * stay synchronous for the proxy): an outer DER SEQUENCE that fills the
 * buffer and, for PKCS#8, the rsaEncryption algorithm; for PKCS#1, the
 * RSAPrivateKey version INTEGER 0. The real proof is the WebCrypto import at
 * mint time.
 */
export function looksLikeRsaPrivateKeyDer(der: Uint8Array, format: 'pkcs8' | 'pkcs1'): boolean {
  const outer = readTlvHeader(der, 0)
  if (!outer || outer.tag !== 0x30 || outer.body + outer.length !== der.length) return false
  const version = readTlvHeader(der, outer.body)
  if (!version || version.tag !== 0x02 || version.length !== 1 || der[version.body] !== 0) return false
  if (format === 'pkcs1') {
    const modulus = readTlvHeader(der, version.body + 1)
    return !!modulus && modulus.tag === 0x02 && modulus.length >= 64
  }
  const algorithm = readTlvHeader(der, version.body + 1)
  if (!algorithm || algorithm.tag !== 0x30) return false
  const oid = der.subarray(algorithm.body, algorithm.body + RSA_ENCRYPTION_OID.length)
  return oid.length === RSA_ENCRYPTION_OID.length && oid.every((byte, i) => byte === RSA_ENCRYPTION_OID[i])
}

const RSA_SIGNING = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const
const MAX_CACHED_KEYS = 4
const keyCache = new Map<string, Promise<CryptoKey>>()

/**
 * Import an RSA private key PEM (PKCS#8 "BEGIN PRIVATE KEY" or PKCS#1
 * "BEGIN RSA PRIVATE KEY") for RS256 signing. Memoised per PEM string; a
 * rejected import is evicted so a corrected key is retried.
 */
export function importRsaSigningKey(pem: string): Promise<CryptoKey> {
  const cached = keyCache.get(pem)
  if (cached) return cached

  const imported = (async () => {
    let format: 'pkcs8' | 'pkcs1'
    if (/-----BEGIN RSA PRIVATE KEY-----/.test(pem)) format = 'pkcs1'
    else if (/-----BEGIN PRIVATE KEY-----/.test(pem)) format = 'pkcs8'
    else throw new MeetingKeyError('The private key must be a PEM RSA private key (BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY).')

    const der = pemToDer(pem)
    const pkcs8 = format === 'pkcs1' ? pkcs1ToPkcs8(der) : der
    try {
      return await globalThis.crypto.subtle.importKey('pkcs8', bufferOf(pkcs8), RSA_SIGNING, false, ['sign'])
    } catch {
      throw new MeetingKeyError('The private key could not be imported as an RSA signing key.')
    }
  })()

  if (keyCache.size >= MAX_CACHED_KEYS) keyCache.clear()
  keyCache.set(pem, imported)
  imported.catch(() => {
    if (keyCache.get(pem) === imported) keyCache.delete(pem)
  })
  return imported
}

function signingInput(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  return `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`
}

/** RS256 JWS compact serialization. `alg` is always forced to RS256. */
export async function signJwtRs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKeyPem: string
): Promise<string> {
  const key = await importRsaSigningKey(privateKeyPem)
  const input = signingInput({ typ: 'JWT', ...header, alg: 'RS256' }, payload)
  const signature = await globalThis.crypto.subtle.sign(RSA_SIGNING.name, key, bufferOf(encoder.encode(input)))
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`
}

/** HS256 JWS compact serialization. `alg` is always forced to HS256. */
export async function signJwtHs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  if (!secret) throw new MeetingKeyError('The token secret is empty.')
  let key: CryptoKey
  try {
    key = await globalThis.crypto.subtle.importKey(
      'raw',
      bufferOf(encoder.encode(secret)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
  } catch {
    throw new MeetingKeyError('The token secret could not be used for HS256 signing.')
  }
  const input = signingInput({ typ: 'JWT', ...header, alg: 'HS256' }, payload)
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, bufferOf(encoder.encode(input)))
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`
}
