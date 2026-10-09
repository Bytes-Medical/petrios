import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const setupInput = z.object({
  code: z.string().min(32).max(256),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(12).max(128),
  organisation: z.string().trim().min(1).max(120),
  department: z.string().trim().min(1).max(120),
})

export function isValidSetupCode(code: string): boolean {
  const expected = process.env.SETUP_TOKEN
  if (process.env.SELF_HOSTED_SETUP !== 'true' || !expected || expected.length < 32) return false
  const a = Buffer.from(code), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
