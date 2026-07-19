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
  it('requires a perfect five-question result', () => {
    const questions = [q(0), q(1), q(2), q(3), q(0)]
    expect(scoreAnswers(questions, [0, 1, 2, 3, 1])).toEqual({
      score: 4,
      total: 5,
      passed: false,
    })
    expect(scoreAnswers(questions, [0, 1, 2, 3, 0]).passed).toBe(true)
  })

  it('treats missing answers as wrong', () => {
    const questions = [q(0), q(1), q(2), q(3), q(0)]
    expect(scoreAnswers(questions, [0]).passed).toBe(false)
    expect(scoreAnswers(questions, []).score).toBe(0)
  })
})

describe('RecallQuestionSetSchema', () => {
  const valid = { questions: [q(0), q(1), q(2), q(3), q(0)] }

  it('accepts exactly five well-formed questions', () => {
    expect(RecallQuestionSetSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects wrong counts, option counts, and out-of-range answers', () => {
    expect(RecallQuestionSetSchema.safeParse({ questions: [q(0), q(1), q(2)] }).success).toBe(false)
    expect(
      RecallQuestionSetSchema.safeParse({
        questions: [q(0), q(1), q(2), q(3), { ...q(0), options: ['a', 'b'] }],
      }).success
    ).toBe(false)
    expect(
      RecallQuestionSetSchema.safeParse({
        questions: [q(0), q(1), q(2), q(3), { ...q(0), answer_index: 4 }],
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
