/**
 * Random human-friendly codes (invite codes, claim tokens, certificate
 * codes). One alphabet everywhere: uppercase + digits with the lookalikes
 * (0/O, 1/I) removed.
 *
 * These codes are capabilities (a teacher invite code opens the RSVP page
 * and, once accepted, a moderator room pass for that session's video room),
 * so the default source is the CSPRNG (WebCrypto, available on Node and
 * Cloudflare Workers), never Math.random.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Uniform float in [0, 1) from the platform CSPRNG (32 random bits). */
export function cryptoRandom(): number {
  const buffer = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buffer)
  return buffer[0] / 0x1_0000_0000
}

export function generateCode(
  length: number,
  random: () => number = cryptoRandom
): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET.charAt(Math.floor(random() * CODE_ALPHABET.length))
  }
  return code
}
