import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openRecapAudioStream } from './audio-recaps'
import { DbError } from './errors'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubEnv('SUPABASE_INTERNAL_URL', 'http://postgrest.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const input = {
  sessionId: '6f1c1d2e-0000-4000-8000-000000000001',
  status: 'approved' as const,
  audioRevision: 3,
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const bytes: number[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return bytes
    bytes.push(...value)
  }
}

describe('openRecapAudioStream', () => {
  it('selects only the audio of the authorized status and revision as one object', async () => {
    fetchMock.mockResolvedValue(new Response('{"audio":"\\\\x494433"}', { status: 200 }))

    const stream = await openRecapAudioStream(input)

    expect(await collect(stream!)).toEqual([0x49, 0x44, 0x33])
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.origin + parsed.pathname).toBe('http://postgrest.test/rest/v1/audio_recaps')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      select: 'audio',
      session_id: `eq.${input.sessionId}`,
      status: 'eq.approved',
      audio_revision: 'eq.3',
    })
    expect(init?.headers).toMatchObject({
      apikey: 'test-service-key',
      Authorization: 'Bearer test-service-key',
      Accept: 'application/vnd.pgrst.object+json',
    })
    expect(init?.cache).toBe('no-store')
  })

  it('resolves null when no row matches', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"code":"PGRST116","message":"Cannot coerce the result to a single JSON object"}', {
        status: 406,
      })
    )
    await expect(openRecapAudioStream(input)).resolves.toBeNull()
  })

  it('resolves null when the audio column is NULL', async () => {
    fetchMock.mockResolvedValue(new Response('{"audio":null}', { status: 200 }))
    await expect(openRecapAudioStream(input)).resolves.toBeNull()
  })

  it('throws a DbError for other PostgREST failures', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"code":"PGRST301","message":"JWT expired"}', { status: 401 })
    )
    await expect(openRecapAudioStream(input)).rejects.toBeInstanceOf(DbError)
  })

  it('throws a DbError for an unexpected body', async () => {
    fetchMock.mockResolvedValue(new Response('{"audio":"not-bytea"}', { status: 200 }))
    await expect(openRecapAudioStream(input)).rejects.toBeInstanceOf(DbError)
  })
})
