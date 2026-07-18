import { describe, expect, it } from 'vitest'
import { claimableSessionDeliveryStatuses } from './session-delivery-policy'

describe('session delivery claim policy', () => {
  it('keeps successful deliveries idempotent by default', () => {
    expect(claimableSessionDeliveryStatuses(false)).toEqual(['PENDING', 'FAILED'])
  })

  it('allows a deliberate moderator resend to reacquire a successful delivery', () => {
    expect(claimableSessionDeliveryStatuses(true)).toEqual(['PENDING', 'FAILED', 'SENT'])
  })
})
