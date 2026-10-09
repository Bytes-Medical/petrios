import { describe, expect, it } from 'vitest'
import { classifyHealthResponse } from './health-check'

describe('classifyHealthResponse', () => {
  it('reports up only for 200 with status ok', () => {
    expect(classifyHealthResponse(200, { status: 'ok', db: 'ok' })).toBe('up')
  })

  it('reports degraded only for 503 with status degraded', () => {
    expect(classifyHealthResponse(503, { status: 'degraded', db: 'error' })).toBe('degraded')
  })

  it.each([
    ['200 with a degraded body', 200, { status: 'degraded' }],
    ['503 with an ok body', 503, { status: 'ok' }],
    ['a 500', 500, { status: 'ok' }],
    ['a 404', 404, null],
    ['a non-object body', 200, 'ok'],
    ['a body without status', 200, { db: 'ok' }],
    ['an array body', 200, ['ok']],
  ])('reports no response for %s', (_name, status, body) => {
    expect(classifyHealthResponse(status, body)).toBe('no-response')
  })
})
