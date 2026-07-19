import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

/**
 * Petrios Recall pure logic: question-set schema, answer scoring, and the
 * HMAC capability tokens used as non-enumerable deep links. Attendance-awarding
 * answers additionally require the matching authenticated registered user.
 */

export const RecallQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  answer_index: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
})

export const RecallQuestionSetSchema = z.object({
  questions: z.array(RecallQuestionSchema).length(5),
})

export type RecallQuestion = z.infer<typeof RecallQuestionSchema>

/** Catch-up mastery requires every published question to be correct. */
export function scoreAnswers(
  questions: RecallQuestion[],
  answers: number[]
): { score: number; total: number; passed: boolean } {
  const total = questions.length
  let score = 0
  questions.forEach((q, i) => {
    if (answers[i] === q.answer_index) score++
  })
  return { score, total, passed: total === 5 && score === total }
}

// ---------------------------------------------------------------------------
// Capability tokens: sessionId.userId.hmac — UUIDs contain no dots.
// ---------------------------------------------------------------------------

function recallSecret(secret?: string): string {
  const resolved = secret ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!resolved) throw new Error('Recall token secret is not configured')
  return resolved
}

function signRecallPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`recall:${payload}`).digest('hex').slice(0, 32)
}

export function makeRecallToken(sessionId: string, userId: string, secret?: string): string {
  const sig = signRecallPayload(`${sessionId}.${userId}`, recallSecret(secret))
  return `${sessionId}.${userId}.${sig}`
}

export function verifyRecallToken(
  token: string,
  secret?: string
): { sessionId: string; userId: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [sessionId, userId, sig] = parts
  const expected = signRecallPayload(`${sessionId}.${userId}`, recallSecret(secret))
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  return { sessionId, userId }
}
