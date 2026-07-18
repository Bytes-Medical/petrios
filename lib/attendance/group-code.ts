import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

const GROUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const GROUP_CODE_LENGTH = 6
const SCRYPT_KEY_BYTES = 32

export function normalizeGroupCode(value: string): string {
  return value.trim().toUpperCase()
}

export function generateSecureGroupCode(): string {
  let code = ''
  for (let index = 0; index < GROUP_CODE_LENGTH; index += 1) {
    code += GROUP_CODE_ALPHABET[randomInt(GROUP_CODE_ALPHABET.length)]
  }
  return code
}

/** Store only a salted, deliberately expensive verifier for the short code. */
export function hashGroupCode(code: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(normalizeGroupCode(code), salt, SCRYPT_KEY_BYTES)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyGroupCode(submittedCode: string, storedVerifier: string): boolean {
  const [algorithm, saltHex, expectedHex, extra] = storedVerifier.split('$')
  if (algorithm !== 'scrypt' || !saltHex || !expectedHex || extra !== undefined) return false
  if (!/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{64}$/i.test(expectedHex)) return false

  const expected = Buffer.from(expectedHex, 'hex')
  const actual = scryptSync(
    normalizeGroupCode(submittedCode),
    Buffer.from(saltHex, 'hex'),
    expected.length
  )
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
