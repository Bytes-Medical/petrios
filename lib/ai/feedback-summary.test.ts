import { beforeEach, describe, expect, it, vi } from 'vitest'

const { askLlmMock } = vi.hoisted(() => ({
  askLlmMock: vi.fn(),
}))

vi.mock('@/lib/ai/llm', () => ({
  askLlm: askLlmMock,
}))

import { summarizeFeedback } from './feedback-summary'

describe('feedback AI summary', () => {
  beforeEach(() => {
    askLlmMock.mockReset()
  })

  it('generates a privacy-processed draft from a single response', async () => {
    askLlmMock.mockResolvedValue(
      'Overall\nThe available evidence is limited and directional.\n\nEvidence note\nInterpret cautiously.'
    )

    const summary = await summarizeFeedback({
      sessionTitle: 'Clinical teaching',
      rows: [{
        rating: 3,
        comment: 'Ada Lovelace asked for more worked examples.',
        answers: [],
        attendee_first_name: 'Ada',
        attendee_last_name: 'Lovelace',
      }],
      questionSummaries: [{
        label: 'Learner engagement',
        averageRating: 3,
        responseCount: 1,
        commentsCount: 1,
      }],
    })

    expect(summary).toContain('limited and directional')
    expect(askLlmMock).toHaveBeenCalledOnce()
    const request = askLlmMock.mock.calls[0][0] as { prompt: string; system: string }
    expect(request.prompt).toContain('Responses: 1')
    expect(request.prompt).toContain('Learner engagement: 3.0/5 from 1 scored responses')
    expect(request.prompt).not.toContain('Ada Lovelace')
    expect(request.system).toContain('Always produce a useful draft when at least one response exists')
  })
})
