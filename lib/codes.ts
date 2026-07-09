/**
 * Random human-friendly codes (invite codes, claim tokens, certificate
 * codes). One alphabet everywhere: uppercase + digits with the lookalikes
 * (0/O, 1/I) removed.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateCode(
  length: number,
  random: () => number = Math.random
): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET.charAt(Math.floor(random() * CODE_ALPHABET.length))
  }
  return code
}
