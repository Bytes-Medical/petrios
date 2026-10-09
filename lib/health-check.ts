/**
 * What the public /open-source self-test reports for a /api/health response
 * (app/api/health/route.ts: 200 {status:'ok'} or 503 {status:'degraded'}).
 * Anything else, including a body that is not that JSON, is reported as no
 * response rather than guessed at.
 */
export type HealthOutcome = 'up' | 'degraded' | 'no-response'

export function classifyHealthResponse(httpStatus: number, body: unknown): HealthOutcome {
  const reported =
    typeof body === 'object' && body !== null ? (body as { status?: unknown }).status : undefined
  if (httpStatus === 200 && reported === 'ok') return 'up'
  if (httpStatus === 503 && reported === 'degraded') return 'degraded'
  return 'no-response'
}
