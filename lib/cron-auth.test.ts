import { describe, expect, it } from 'vitest'
import { isAuthorizedCronRequest } from './cron-auth'

describe('isAuthorizedCronRequest', () => {
  const secret = 'test-cron-secret'

  it('accepts a valid Bearer token', () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true)
  })

  it('rejects a missing header', () => {
    expect(isAuthorizedCronRequest(null, secret)).toBe(false)
  })

  it('rejects the wrong token and malformed headers', () => {
    expect(isAuthorizedCronRequest('Bearer wrong', secret)).toBe(false)
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false) // no scheme
    expect(isAuthorizedCronRequest(`Basic ${secret}`, secret)).toBe(false)
    expect(isAuthorizedCronRequest('Bearer ', secret)).toBe(false)
  })

  it('rejects everything when no secret is configured', () => {
    expect(isAuthorizedCronRequest('Bearer anything', undefined)).toBe(false)
    expect(isAuthorizedCronRequest('Bearer ', '')).toBe(false)
  })
})
