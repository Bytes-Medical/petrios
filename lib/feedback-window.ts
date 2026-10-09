// The one feedback-window rule shared by `submitFeedback` and the public
// feedback pages (spec/05). Both endpoints are inclusive, and the per-session
// minutes use `??` because a configured zero is meaningful.

export const DEFAULT_FEEDBACK_OPENS_MINS_BEFORE_START = 15
export const DEFAULT_FEEDBACK_CLOSES_MINS_AFTER_END = 120

const MINUTE_MS = 60 * 1000

export interface FeedbackWindowSession {
  date_start: string
  date_end: string
  checkin_open_mins_before?: number | null
  feedback_valid_mins_after_end?: number | null
}

export interface FeedbackWindowBounds {
  opensAt: Date
  closesAt: Date
}

export type FeedbackWindowStatus = 'NOT_YET_OPEN' | 'OPEN' | 'CLOSED'

/** Null when the session timestamps cannot be parsed. */
export function getFeedbackWindowBounds(
  session: FeedbackWindowSession
): FeedbackWindowBounds | null {
  const opensAt = new Date(session.date_start).getTime()
    - (session.checkin_open_mins_before ?? DEFAULT_FEEDBACK_OPENS_MINS_BEFORE_START) * MINUTE_MS
  const closesAt = new Date(session.date_end).getTime()
    + (session.feedback_valid_mins_after_end ?? DEFAULT_FEEDBACK_CLOSES_MINS_AFTER_END) * MINUTE_MS

  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt)) return null
  return { opensAt: new Date(opensAt), closesAt: new Date(closesAt) }
}

export function getFeedbackWindowStatus(
  session: FeedbackWindowSession,
  now: Date | number = Date.now()
): FeedbackWindowStatus {
  const bounds = getFeedbackWindowBounds(session)
  // Unparseable timestamps fail closed rather than comparing against NaN,
  // which would otherwise read as "open".
  if (!bounds) return 'CLOSED'

  const nowMs = typeof now === 'number' ? now : now.getTime()
  if (nowMs < bounds.opensAt.getTime()) return 'NOT_YET_OPEN'
  if (nowMs > bounds.closesAt.getTime()) return 'CLOSED'
  return 'OPEN'
}

export function isFeedbackWindowOpen(
  session: FeedbackWindowSession,
  now: Date | number = Date.now()
): boolean {
  return getFeedbackWindowStatus(session, now) === 'OPEN'
}
