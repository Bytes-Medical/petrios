import { describe, expect, it } from 'vitest'
import {
  RecallQuestionSetSchema,
  makeRecallToken,
  scoreAnswers,
  verifyRecallToken,
  type RecallQuestion,
} from './recall'

const q = (answer_index: number): RecallQuestion => ({
  question: 'Q',
  options: ['a', 'b', 'c', 'd'],
  answer_index,
  explanation: 'because',
})

describe('scoreAnswers', () => {
  it('passes at 2 of 3 and above', () => {
    expect(scoreAnswers([q(0), q(1), q(2)], [0, 1, 3])).toEqual({
      score: 2,
      total: 3,
      passed: true,
    })
    expect(scoreAnswers([q(0), q(1), q(2)], [0, 1, 2]).passed).toBe(true)
  })

  it('fails at 1 of 3 and treats missing answers as wrong', () => {
    expect(scoreAnswers([q(0), q(1), q(2)], [0]).passed).toBe(false)
    expect(scoreAnswers([q(0), q(1), q(2)], []).score).toBe(0)
  })
})

describe('RecallQuestionSetSchema', () => {
  const valid = { questions: [q(0), q(1), q(2)] }

  it('accepts exactly three well-formed questions', () => {
    expect(RecallQuestionSetSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects wrong counts, option counts, and out-of-range answers', () => {
    expect(RecallQuestionSetSchema.safeParse({ questions: [q(0)] }).success).toBe(false)
    expect(
      RecallQuestionSetSchema.safeParse({
        questions: [q(0), q(1), { ...q(2), options: ['a', 'b'] }],
      }).success
    ).toBe(false)
    expect(
      RecallQuestionSetSchema.safeParse({
        questions: [q(0), q(1), { ...q(2), answer_index: 4 }],
      }).success
    ).toBe(false)
  })
})

describe('recall tokens', () => {
  const secret = 'test-secret'
  const sessionId = '11111111-2222-3333-4444-555555555555'
  const userId = '66666666-7777-8888-9999-000000000000'

  it('round-trips', () => {
    const token = makeRecallToken(sessionId, userId, secret)
    expect(verifyRecallToken(token, secret)).toEqual({ sessionId, userId })
  })

  it('rejects tampering and wrong secrets', () => {
    const token = makeRecallToken(sessionId, userId, secret)
    const [s, u, sig] = token.split('.')
    expect(verifyRecallToken(`${s}.${s}.${sig}`, secret)).toBeNull()
    expect(verifyRecallToken(`${s}.${u}.${'0'.repeat(sig.length)}`, secret)).toBeNull()
    expect(verifyRecallToken('nonsense', secret)).toBeNull()
    expect(verifyRecallToken(makeRecallToken(sessionId, userId, 'other'), secret)).toBeNull()
  })
})
