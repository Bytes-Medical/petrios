import { askLlm } from '@/lib/ai/llm'
import type { StoredFeedbackRow } from '@/lib/db/feedback'

const SYSTEM_PROMPT = `You summarise anonymous attendee feedback on NHS postgraduate teaching sessions for the session organiser and teacher.

Rules:
- Only describe feedback that is actually present; never invent, extrapolate, or soften it.
- Feedback is anonymous — do not attribute comments to names even if names appear.
- Be specific and useful for improving the next session.

Format (plain text, no markdown syntax beyond hyphen bullets):
Overall: one sentence on sentiment and the average rating.
Themes: 2-5 hyphen bullets, each a recurring point with a rough count, e.g. "- Pacing too fast in the second half (3 mentions)".
Suggestions: 1-3 hyphen bullets with concrete, actionable improvements drawn from the feedback.
If there are fewer than 3 comments, keep it to Overall plus at most one bullet.`

export interface FeedbackSummaryInput {
  sessionTitle: string
  rows: Pick<StoredFeedbackRow, 'rating' | 'comment' | 'answers'>[]
}

function buildPrompt(input: FeedbackSummaryInput): string {
  const ratings = input.rows
    .map((r) => r.rating)
    .filter((r): r is number => typeof r === 'number')
  const average =
    ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : 'n/a'

  const comments = input.rows
    .map((r) => r.comment?.trim())
    .filter((c): c is string => !!c)

  return [
    `Session: "${input.sessionTitle}"`,
    `Responses: ${input.rows.length}`,
    `Average rating: ${average}/5 (${ratings.length} rated)`,
    '',
    'Comments (one per line, anonymised):',
    ...(comments.length > 0
      ? comments.map((c) => `- ${c.replace(/\n+/g, ' ')}`)
      : ['(no free-text comments)']),
  ].join('\n')
}

/** Returns a plain-text summary, or null when no AI provider is configured. */
export async function summarizeFeedback(
  input: FeedbackSummaryInput
): Promise<string | null> {
  const text = await askLlm({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    maxTokens: 2048,
    effort: 'low',
  })
  return text?.trim() || null
}
