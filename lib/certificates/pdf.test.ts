import { describe, expect, it } from 'vitest'
import { generateCertificatePDF } from './pdf'

describe('certificate PDF', () => {
  it('renders a branded certificate with multiple teaching coordinators', async () => {
    const output = await generateCertificatePDF({
      orgName: 'Petrios Teaching Organisation',
      departmentName: 'Paediatrics',
      sessionTitle: 'Managing the Deteriorating Child',
      sessionDate: '18 July 2026',
      recipientName: 'Dr Jane Doe',
      role: 'Attendee',
      certificateCode: 'PTR-TEST-001',
      issuedDate: '18 July 2026',
      verifyUrl: 'https://petrios.com/verify/PTR-TEST-001',
      coordinatorNames: ['Dr Alex Smith', 'Professor Sam Lee'],
      issuerName: 'Dr Rowan Williams',
    })

    expect(output.subarray(0, 4).toString()).toBe('%PDF')
    expect(output.byteLength).toBeGreaterThan(10_000)
  })
})
