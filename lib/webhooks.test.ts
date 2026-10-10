import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Delivery transport for org-admin webhooks. A loopback listener stands in
// for both a legitimate consumer (reachable only through the explicit
// WEBHOOK_ALLOW_PRIVATE opt-in) and an internal service the guard must never
// reach. DNS is injected, so no real lookups or outbound traffic happen.

const db = vi.hoisted(() => ({
  endpoints: [] as { id: string; url: string; secret: string }[],
  deliveries: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/db/api-platform', () => ({
  listActiveEndpointsForEvent: async () => db.endpoints,
  insertWebhookDelivery: async (row: Record<string, unknown>) => {
    db.deliveries.push(row)
  },
}))

import {
  assertPublicResolvedAddresses,
  createGuardedLookup,
  emitWebhook,
  postWebhook,
  signWebhookBody,
} from './webhooks'

interface Hit {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

let server: Server
let port = 0
const hits: Hit[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/inner` })
        res.end()
        return
      }
      res.writeHead(204)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  hits.length = 0
  db.endpoints = []
  db.deliveries = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))

describe('assertPublicResolvedAddresses', () => {
  it('rejects when any resolved address is private, or none resolved', () => {
    expect(() =>
      assertPublicResolvedAddresses('rebind.example.org', [
        { address: '93.184.215.14', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ])
    ).toThrow(/non-public/)
    expect(() => assertPublicResolvedAddresses('empty.example.org', [])).toThrow(/non-public/)
    expect(() =>
      assertPublicResolvedAddresses('v6.example.org', [{ address: '::ffff:169.254.169.254', family: 6 }])
    ).toThrow(/non-public/)
    expect(() =>
      assertPublicResolvedAddresses('ok.example.org', [{ address: '93.184.215.14', family: 4 }])
    ).not.toThrow()
  })
})

describe('createGuardedLookup', () => {
  function lookup(resolve: ReturnType<typeof resolveTo>, options: { all?: boolean; family?: number }) {
    return new Promise<{ error: unknown; address: unknown; family: unknown }>((done) => {
      createGuardedLookup(resolve)('hooks.example.org', options, (error, address, family) =>
        done({ error, address, family })
      )
    })
  }

  it('hands back only checked public addresses (single and all forms)', async () => {
    const single = await lookup(resolveTo('93.184.215.14', '2606:4700::1'), {})
    expect(single).toEqual({ error: null, address: '93.184.215.14', family: 4 })

    const all = await lookup(resolveTo('93.184.215.14', '2606:4700::1'), { all: true })
    expect(all.error).toBeNull()
    expect(all.address).toEqual([
      { address: '93.184.215.14', family: 4 },
      { address: '2606:4700::1', family: 6 },
    ])

    const v6 = await lookup(resolveTo('93.184.215.14', '2606:4700::1'), { family: 6 })
    expect(v6).toEqual({ error: null, address: '2606:4700::1', family: 6 })
  })

  it('fails the connection when a name resolves to a private address', async () => {
    const result = await lookup(resolveTo('127.0.0.1'), {})
    expect(result.error).toBeInstanceOf(Error)
    expect((result.error as NodeJS.ErrnoException).code).toBe('EWEBHOOKBLOCKED')
  })
})

describe('postWebhook (Node transport)', () => {
  const headers = { 'Content-Type': 'application/json' }

  it('refuses a loopback literal without the opt-in and never connects', async () => {
    const result = await postWebhook(`http://127.0.0.1:${port}/hook`, headers, '{}', { runtime: 'node' })
    expect(result).toEqual({ ok: false, status: null })
    expect(hits).toHaveLength(0)
  })

  it('refuses a public-looking name whose DNS answer is loopback (rebinding)', async () => {
    const result = await postWebhook(`http://hooks.example.org:${port}/hook`, headers, '{}', {
      runtime: 'node',
      resolveAll: resolveTo('127.0.0.1'),
    })
    expect(result).toEqual({ ok: false, status: null })
    expect(hits).toHaveLength(0)
  })

  it('delivers to a listener when private targets are explicitly allowed', async () => {
    const result = await postWebhook(`http://127.0.0.1:${port}/hook`, headers, '{"a":1}', {
      runtime: 'node',
      allowPrivate: true,
    })
    expect(result).toEqual({ ok: true, status: 204 })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ method: 'POST', url: '/hook', body: '{"a":1}' })
    expect(hits[0].headers['content-type']).toBe('application/json')
  })

  it('does not follow redirects; a 3xx is a failed delivery', async () => {
    const result = await postWebhook(`http://127.0.0.1:${port}/redirect`, headers, '{}', {
      runtime: 'node',
      allowPrivate: true,
    })
    expect(result).toEqual({ ok: false, status: 302 })
    expect(hits.map((hit) => hit.url)).toEqual(['/redirect'])
  })
})

describe('postWebhook (Workers transport)', () => {
  it('uses fetch with redirect: manual and treats 3xx as failure', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 301 }))
    const result = await postWebhook('https://hooks.example.org/x', {}, '{}', {
      runtime: 'workers',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: false, status: 301 })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hooks.example.org/x',
      expect.objectContaining({ method: 'POST', redirect: 'manual' })
    )
  })

  it('still applies the URL guard before fetch', async () => {
    const fetchImpl = vi.fn()
    const result = await postWebhook('http://metadata.google.internal/', {}, '{}', {
      runtime: 'workers',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: false, status: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('emitWebhook', () => {
  it('records a blocked private endpoint as failed without contacting it', async () => {
    db.endpoints = [{ id: 'ep-1', url: `http://127.0.0.1:${port}/hook`, secret: 'whsec_test' }]

    await emitWebhook('org-1', 'session.published', { session_id: 's-1' }, { runtime: 'node' })

    expect(hits).toHaveLength(0)
    expect(db.deliveries).toEqual([
      expect.objectContaining({ endpointId: 'ep-1', status: 'failed', responseCode: null }),
    ])
  })

  it('signs and delivers when WEBHOOK_ALLOW_PRIVATE=true', async () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'true')
    db.endpoints = [{ id: 'ep-1', url: `http://127.0.0.1:${port}/hook`, secret: 'whsec_test' }]

    await emitWebhook('org-1', 'session.published', { session_id: 's-1' }, { runtime: 'node' })

    expect(hits).toHaveLength(1)
    expect(hits[0].headers['x-petrios-event']).toBe('session.published')
    expect(hits[0].headers['x-petrios-signature']).toBe(signWebhookBody('whsec_test', hits[0].body))
    expect(db.deliveries).toEqual([
      expect.objectContaining({ endpointId: 'ep-1', status: 'ok', responseCode: 204 }),
    ])
  })

  it('never rejects', async () => {
    db.endpoints = [{ id: 'ep-1', url: 'not a url', secret: 's' }]
    await expect(emitWebhook('org-1', 'slot.claimed', {})).resolves.toBeUndefined()
    expect(db.deliveries).toEqual([expect.objectContaining({ status: 'failed' })])
  })
})
