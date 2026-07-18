import { describe, expect, it } from 'vitest'
import { buildSignatories } from './signatories'

describe('certificate signatories', () => {
  it('lists each coordinator in order and then a distinct issuer', () => {
    expect(
      buildSignatories({
        coordinatorNames: ['Dr Jane Smith', 'Professor Sam Lee'],
        issuerName: 'Alex Morgan',
      })
    ).toEqual([
      { label: 'Teaching coordinator', value: 'Dr Jane Smith' },
      { label: 'Teaching coordinator', value: 'Professor Sam Lee' },
      { label: 'Issued by', value: 'Alex Morgan' },
    ])
  })

  it('does not repeat a coordinator who issued the certificate', () => {
    expect(
      buildSignatories({ coordinatorNames: ['Dr Jane Smith'], issuerName: ' dr jane smith ' })
    ).toEqual([{ label: 'Teaching coordinator', value: 'Dr Jane Smith' }])
  })
})
