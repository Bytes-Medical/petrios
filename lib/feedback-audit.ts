import type { SubmittedFeedbackAnswer } from '@/lib/types'

export interface FeedbackAuditEntry {
  id: string
  attendee_first_name: string | null
  attendee_last_name: string | null
  attendee_email: string | null
  rating: number | null
  comment: string | null
  answers: SubmittedFeedbackAnswer[]
  created_at: string
}

export type FeedbackAuditScoreBand = 'all' | 'low' | 'middle' | 'high'
export type FeedbackAuditSort = 'newest' | 'oldest' | 'lowest' | 'highest'

export function answeredFeedbackFields(entry: FeedbackAuditEntry) {
  return entry.answers.filter((answer) => Boolean(answer.value || answer.comment))
}

export function writtenFeedbackCount(entry: FeedbackAuditEntry): number {
  const answerTextCount = entry.answers.reduce((count, answer) => {
    const hasTextValue =
      answer.type !== 'rating' &&
      typeof answer.value === 'string' &&
      answer.value.trim().length > 0
    const hasComment =
      typeof answer.comment === 'string' && answer.comment.trim().length > 0
    return count + (hasTextValue ? 1 : 0) + (hasComment ? 1 : 0)
  }, 0)
  return answerTextCount || (entry.comment?.trim() ? 1 : 0)
}

function matchesScoreBand(rating: number | null, band: FeedbackAuditScoreBand) {
  if (band === 'all') return true
  if (rating === null) return false
  if (band === 'low') return rating < 3
  if (band === 'middle') return rating >= 3 && rating < 4
  return rating >= 4
}

function searchableText(entry: FeedbackAuditEntry): string {
  const answerText = entry.answers.flatMap((answer) => [
    answer.label,
    typeof answer.value === 'string' ? answer.value : '',
    answer.comment ?? '',
  ])
  return [
    entry.attendee_first_name ?? '',
    entry.attendee_last_name ?? '',
    entry.attendee_email ?? '',
    entry.comment ?? '',
    ...answerText,
  ]
    .join(' ')
    .toLocaleLowerCase()
}

export function filterAndSortFeedbackAudit(
  entries: FeedbackAuditEntry[],
  options: {
    query: string
    scoreBand: FeedbackAuditScoreBand
    writtenOnly: boolean
    sort: FeedbackAuditSort
  }
): FeedbackAuditEntry[] {
  const query = options.query.trim().toLocaleLowerCase()
  return entries
    .filter((entry) => !query || searchableText(entry).includes(query))
    .filter((entry) => matchesScoreBand(entry.rating, options.scoreBand))
    .filter((entry) => !options.writtenOnly || writtenFeedbackCount(entry) > 0)
    .sort((left, right) => {
      if (options.sort === 'newest' || options.sort === 'oldest') {
        const delta = Date.parse(right.created_at) - Date.parse(left.created_at)
        return options.sort === 'newest' ? delta : -delta
      }
      if (left.rating === null && right.rating === null) return 0
      if (left.rating === null) return 1
      if (right.rating === null) return -1
      const leftRating = left.rating
      const rightRating = right.rating
      const delta = leftRating - rightRating
      return options.sort === 'lowest' ? delta : -delta
    })
}
