import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getEmailClient,
  normalizeSenderDisplayName,
  outboundEmailRefusal,
  parseResendProviderMessageId,
} from './email'

describe('normalizeSenderDisplayName', () => {
  it.each([
    'Byte Teaching <login@example.org>',
    'Bytes Teaching <login@example.org>',
    'byte-teaching <login@example.org>',
    '"Byte Teaching" <login@example.org>',
  ])('rebrands the legacy sender name in %s', (from) => {
    expect(normalizeSenderDisplayName(from)).toBe('Petrios <login@example.org>')
  })

  it('adds Petrios to a bare sender address', () => {
    expect(normalizeSenderDisplayName('login@example.org')).toBe(
      'Petrios <login@example.org>'
    )
  })

  it('preserves an intentionally customized organization name', () => {
    expect(normalizeSenderDisplayName('Trust Education <login@example.org>')).toBe(
      'Trust Education <login@example.org>'
    )
  })

  it('preserves an existing Petrios sender name', () => {
    expect(normalizeSenderDisplayName('Petrios <login@example.org>')).toBe(
      'Petrios <login@example.org>'
    )
  })
})

describe('Resend provider receipts', () => {
  it('accepts and trims a traceable provider message id', () => {
    expect(parseResendProviderMessageId({ id: '  msg_123  ' })).toBe('msg_123')
  })

  it('rejects success payloads without a usable provider message id', () => {
    expect(parseResendProviderMessageId({})).toBeNull()
    expect(parseResendProviderMessageId({ id: '' })).toBeNull()
    expect(parseResendProviderMessageId({ id: 123 })).toBeNull()
    expect(parseResendProviderMessageId(null)).toBeNull()
  })
})

describe('outbound email switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('leaves email unchanged unless OUTBOUND_EMAIL_ENABLED is exactly "false"', () => {
    for (const value of [undefined, '', 'true', 'FALSE', '0', 'no']) {
      expect(outboundEmailRefusal(['someone@example.org'], { OUTBOUND_EMAIL_ENABLED: value })).toBeNull()
    }
  })

  it('refuses every recipient when disabled, except an allowlisted one', () => {
    const env = {
      OUTBOUND_EMAIL_ENABLED: 'false',
      OUTBOUND_EMAIL_ALLOWLIST: ' Operator@Example.org , second@example.org',
    }
    expect(outboundEmailRefusal(['trainee@nhs.net'], env)).toMatch(/OUTBOUND_EMAIL_ENABLED=false/)
    expect(outboundEmailRefusal(['operator@example.org'], env)).toBeNull()
    expect(outboundEmailRefusal(['Operator <OPERATOR@example.org>'], env)).toBeNull()
    // One unlisted recipient refuses the whole send.
    expect(outboundEmailRefusal(['operator@example.org', 'trainee@nhs.net'], env)).not.toBeNull()
    expect(outboundEmailRefusal([], env)).not.toBeNull()
    expect(outboundEmailRefusal(['operator@example.org'], { OUTBOUND_EMAIL_ENABLED: 'false' })).not.toBeNull()
  })

  it('returns an ordinary error without contacting the provider when disabled', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'msg_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key')
    vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'false')
    vi.stubEnv('OUTBOUND_EMAIL_ALLOWLIST', 'operator@example.org')
    const message = { from: 'Petrios <no-reply@example.org>', subject: 'Certificate', html: '<p>x</p>' }

    const refused = await getEmailClient().emails.send({ ...message, to: 'trainee@nhs.net' })
    expect(refused.data).toBeNull()
    expect(refused.error?.message).toMatch(/OUTBOUND_EMAIL_ENABLED=false/)
    expect(fetchSpy).not.toHaveBeenCalled()

    const allowed = await getEmailClient().emails.send({ ...message, to: 'operator@example.org' })
    expect(allowed).toEqual({ data: { id: 'msg_1' }, error: null })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    vi.stubEnv('OUTBOUND_EMAIL_ENABLED', '')
    const normal = await getEmailClient().emails.send({ ...message, to: 'trainee@nhs.net' })
    expect(normal.error).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

describe('Resend request options', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const message = {
    from: 'Petrios <no-reply@example.org>',
    to: 'trainee@nhs.net',
    subject: 'Weekly teaching',
    html: '<p>x</p>',
  }

  function stubResend(response: Response) {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.fn<typeof fetch>(async () => response)
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key')
    vi.stubEnv('OUTBOUND_EMAIL_ENABLED', '')
    return fetchSpy
  }

  it('sends the idempotency key and custom headers, bounded by a timeout', async () => {
    const fetchSpy = stubResend(
      new Response(JSON.stringify({ id: 'msg_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    await getEmailClient().emails.send({
      ...message,
      idempotencyKey: 'ops-newsletter/d-1/2',
      headers: { 'List-Unsubscribe': '<https://app.test/u>' },
    })
    const [, init] = fetchSpy.mock.calls[0]
    expect(init?.headers).toMatchObject({ 'Idempotency-Key': 'ops-newsletter/d-1/2' })
    expect(JSON.parse(String(init?.body)).headers).toEqual({ 'List-Unsubscribe': '<https://app.test/u>' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('omits the idempotency header when no key is given', async () => {
    const fetchSpy = stubResend(
      new Response(JSON.stringify({ id: 'msg_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    await getEmailClient().emails.send(message)
    const [, init] = fetchSpy.mock.calls[0]
    expect(init?.headers).not.toHaveProperty('Idempotency-Key')
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('headers')
  })

  it('reports the status and Retry-After of a rate-limited request', async () => {
    stubResend(
      new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
      })
    )
    const result = await getEmailClient().emails.send(message)
    expect(result.error).toEqual({ message: 'Too many requests', statusCode: 429, retryAfterSeconds: 2 })
  })
})
