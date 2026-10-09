import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_NEXT_ENV_MODULE,
  STREAMING_BACKPRESSURE_MARKER,
  isLocalEnvFile,
  leakCandidates,
  namesFoundIn,
  nextEnvKeyNames,
  parseWranglerConfig,
  patchOpenNextStreamingBackpressure,
  secretsFileNames,
  secretsFileProblems,
  stagingConfigProblems,
  validateStagingAppUrl,
} from './lib.mjs'

const root = path.resolve(__dirname, '..', '..')
const wranglerConfig = parseWranglerConfig(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'))

describe('next-env snapshot', () => {
  it('reports variable names per mode, never values', () => {
    const names = nextEnvKeyNames({
      production: { SUPABASE_SERVICE_ROLE_KEY: 'fake-secret-for-guard-test-1234567890' },
      development: {},
      test: { CRON_SECRET: 'x' },
    })
    expect(names).toEqual(['production.SUPABASE_SERVICE_ROLE_KEY', 'test.CRON_SECRET'])
    expect(names.join()).not.toContain('fake-secret')
  })

  it('scrubs every mode OpenNext can select at runtime', () => {
    expect(EMPTY_NEXT_ENV_MODULE).toBe(
      'export const production = {};\nexport const development = {};\nexport const test = {};\n'
    )
    expect(nextEnvKeyNames({ production: {}, development: {}, test: {} })).toEqual([])
  })

  it('fails loudly if OpenNext stops exporting a mode', () => {
    expect(() => nextEnvKeyNames({ production: {}, development: {} })).toThrow(/"test"/)
  })
})

describe('local env leak candidates', () => {
  it('matches every dotenv variant except the committed example', () => {
    expect(['.env', '.env.local', '.env.production', '.env.staging.local'].every(isLocalEnvFile)).toBe(true)
    expect(['.env.example', '.envrc', 'env', '.dev.vars'].some(isLocalEnvFile)).toBe(false)
  })

  it('skips short values and values already public in .env.example; separates NEXT_PUBLIC_*', () => {
    const { secret, browserPublic } = leakCandidates(
      [
        { name: 'SUPABASE_SERVICE_ROLE_KEY', value: 'fake-secret-for-guard-test-1234567890' },
        { name: 'TTS_PROVIDER', value: 'elevenlabs' },
        { name: 'ELEVENLABS_MODEL_ID', value: 'eleven_multilingual_v2' },
        { name: 'NEXT_PUBLIC_SUPABASE_URL', value: 'https://abcdefgh.supabase.co' },
      ],
      '# ELEVENLABS_MODEL_ID=eleven_multilingual_v2\n'
    )
    expect(secret.map((candidate) => candidate.name)).toEqual(['SUPABASE_SERVICE_ROLE_KEY'])
    expect(browserPublic.map((candidate) => candidate.name)).toEqual(['NEXT_PUBLIC_SUPABASE_URL'])
  })

  it('finds raw and JSON-escaped values in uploaded bytes', () => {
    const { secret } = leakCandidates(
      [
        { name: 'PLAIN', value: 'plain-secret-value-123' },
        { name: 'MULTILINE', value: 'line-one-secret\nline-two' },
        { name: 'ABSENT', value: 'never-bundled-value-456' },
      ],
      ''
    )
    const bundle = [Buffer.from('const a = "plain-secret-value-123";'), Buffer.from('{"k":"line-one-secret\\nline-two"}')]
    expect(namesFoundIn(secret, bundle)).toEqual(['MULTILINE', 'PLAIN'])
  })
})

describe('staging APP_URL', () => {
  it('accepts only the Worker’s own workers.dev origin', () => {
    expect(validateStagingAppUrl('https://petrios-staging.acme-trust.workers.dev', 'petrios-staging')).toEqual({
      origin: 'https://petrios-staging.acme-trust.workers.dev',
    })
    expect(validateStagingAppUrl('https://petrios-staging.acme.workers.dev/', 'petrios-staging').origin).toBe(
      'https://petrios-staging.acme.workers.dev'
    )
  })

  it.each([
    undefined,
    '',
    'petrios-staging.acme.workers.dev',
    'http://petrios-staging.acme.workers.dev',
    'https://localhost:8787',
    'https://petrios.acme.workers.dev',
    'https://teaching.example.nhs.uk',
    'https://petrios-staging.acme.workers.dev.evil.example',
    'https://petrios-staging.acme.workers.dev/login',
    'https://petrios-staging.acme.workers.dev?x=1',
    'https://petrios-staging.acme.workers.dev:8443',
    'https://user:pass@petrios-staging.acme.workers.dev',
  ])('rejects %s', (value) => {
    expect(validateStagingAppUrl(value, 'petrios-staging').error).toBeTruthy()
  })
})

describe('wrangler config checks', () => {
  it('parses JSONC with comments and trailing commas', () => {
    expect(parseWranglerConfig('// c\n{ "name": "x", /* c */ "vars": { "A": "1", }, }')).toEqual({
      name: 'x',
      vars: { A: '1' },
    })
  })

  it('flags staging configs that could run crons, claim routes or email real users', () => {
    const vars = {
      CRON_ENABLED: 'false',
      OUTBOUND_EMAIL_ENABLED: 'false',
      TRUSTED_CLIENT_IP_HEADER: 'cf-connecting-ip',
    }
    const safe = { workers_dev: true, triggers: { crons: [] }, vars }
    expect(stagingConfigProblems(safe)).toEqual([])
    expect(stagingConfigProblems({ ...safe, triggers: { crons: ['0 * * * *'] } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, triggers: undefined })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, TRUSTED_CLIENT_IP_HEADER: undefined } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, routes: [{ pattern: 'teaching.example/*' }] })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, workers_dev: false })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, CRON_ENABLED: 'true' } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, OUTBOUND_EMAIL_ENABLED: 'true' } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { CRON_ENABLED: 'false' } })).toHaveLength(2)
  })

  it('accepts the committed top level (staging) of wrangler.jsonc', () => {
    expect(stagingConfigProblems(wranglerConfig)).toEqual([])
    expect(wranglerConfig.env.production.vars.OUTBOUND_EMAIL_ENABLED).toBe('true')
  })
})

describe('first-deploy secrets file', () => {
  const outside = { filePath: '/home/operator/petrios-staging.secrets', root: '/home/operator/petrios' }
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET']

  it('reads names the way wrangler does, dotenv or JSON, never values', () => {
    const dotenv = [
      '# staging',
      'SUPABASE_URL=https://abcdefgh.supabase.co',
      'export CRON_SECRET="placeholder-cron-secret"',
      'APP_URL: http://localhost:8787',
      "MULTI='line one",
      "line two'",
      '',
    ].join('\r\n')
    expect(secretsFileNames(dotenv)).toEqual({ names: ['SUPABASE_URL', 'CRON_SECRET', 'APP_URL', 'MULTI'] })
    expect(secretsFileNames('{"SUPABASE_URL":"x","CRON_SECRET":"y"}')).toEqual({
      names: ['SUPABASE_URL', 'CRON_SECRET'],
    })
    expect(secretsFileNames('["SUPABASE_URL"]').error).toBeTruthy()
    expect(secretsFileNames('# nothing here\n').error).toBeTruthy()
  })

  it('accepts only the Worker secrets, from a file outside the repository', () => {
    expect(secretsFileProblems([...required, 'OPENAI_API_KEY', 'OUTBOUND_EMAIL_ALLOWLIST'], wranglerConfig, outside)).toEqual([])
  })

  it.each([
    ['APP_URL', /APP_URL/],
    ['CRON_ENABLED', /CRON_ENABLED/],
    ['OUTBOUND_EMAIL_ENABLED', /OUTBOUND_EMAIL_ENABLED/],
    ['SUPABASE_INTERNAL_URL', /never set on Workers/],
    ['NEXTJS_ENV', /never set on Workers/],
    ['NEXT_PUBLIC_APP_URL', /APP_URL fallback/],
  ])('refuses a file that sets %s', (name, reason) => {
    const problems = secretsFileProblems([...required, name], wranglerConfig, outside)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(reason)
  })

  it.each([
    ['/home/operator/petrios/petrios-staging.secrets', /outside the repository/],
    ['/home/operator/petrios/deploy/staging.json', /outside the repository/],
    ['/home/operator/.dev.vars', /local env file/],
    ['/home/operator/.dev.vars.staging', /local env file/],
    ['/home/operator/.env.production', /local env file/],
  ])('refuses %s', (filePath, reason) => {
    const problems = secretsFileProblems(required, wranglerConfig, { filePath, root: outside.root })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(reason)
  })

  it('treats a sibling directory with the same prefix as outside the repository', () => {
    expect(
      secretsFileProblems(required, wranglerConfig, { filePath: '/home/operator/petrios-secrets/s.env', root: outside.root })
    ).toEqual([])
  })
})

// The `cloudflare-node` wrapper exactly as OpenNext 4.1.9 + esbuild minify it
// into .open-next/server-functions/default/handler.mjs.
const OPENNEXT_4_1_9_WRAPPER =
  'var NULL_BODY_STATUSES2,handler,cloudflare_node_default,init_cloudflare_node=__esm2({"node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js"(){NULL_BODY_STATUSES2=new Set([101,204,205,304]),handler=async(handler3,converter2)=>async(request,env,ctx,abortSignal)=>{globalThis.process=process;for(let[key,value2]of Object.entries(env))typeof value2=="string"&&(process.env[key]=value2);let internalEvent=await converter2.convertFrom(request),url2=new URL(request.url),{promise:promiseResponse,resolve:resolveResponse}=Promise.withResolvers(),streamCreator={writeHeaders(prelude){let{statusCode,cookies,headers}=prelude,responseHeaders=new Headers(headers);for(let cookie of cookies)responseHeaders.append("Set-Cookie",cookie);if(url2.hostname==="localhost"&&responseHeaders.set("Content-Encoding","identity"),NULL_BODY_STATUSES2.has(statusCode)){let response2=new Response(null,{status:statusCode,headers:responseHeaders});return resolveResponse(response2),new Writable({write(chunk,encoding,callback){callback()}})}let controller,readable=new ReadableStream({start(c3){controller=c3}}),response=new Response(readable,{status:statusCode,headers:responseHeaders});return resolveResponse(response),new Writable({write(chunk,encoding,callback){try{controller.enqueue(chunk)}catch(e4){return callback(e4)}callback()},final(callback){controller.close(),callback()},destroy(error2,callback){if(error2)controller.error(error2);else try{controller.close()}catch{}callback(error2)}})},abortSignal,retainChunks:!1};return ctx.waitUntil(handler3(internalEvent,{streamCreator,waitUntil:ctx.waitUntil.bind(ctx)})),promiseResponse},cloudflare_node_default={wrapper:handler,name:"cloudflare-node",supportStreaming:!0}}})'

type StreamCreator = {
  writeHeaders(prelude: { statusCode: number; cookies: string[]; headers: Record<string, string> }): Writable
}
type NextHandler = (event: unknown, options: { streamCreator: StreamCreator }) => Promise<void>
type WorkerFetch = (
  request: Request,
  env: Record<string, string>,
  ctx: { waitUntil(promise: Promise<unknown>): void }
) => Promise<Response>
type Wrapper = (next: NextHandler, converter: { convertFrom(request: Request): Promise<unknown> }) => Promise<WorkerFetch>

function loadWrapper(bundleSource: string): Wrapper {
  const esm = (definition: Record<string, () => void>) => () => Object.values(definition)[0]()
  return new Function('__esm2', 'Writable', `${bundleSource};init_cloudflare_node();return handler`)(esm, Writable)
}

const CHUNK_BYTES = 16 * 1024
const TOTAL_BYTES = 8 * 1024 * 1024

/** A streamed 8 MiB download whose producer honours backpressure the way Next's pipeToNodeResponse does. */
async function startDownload(bundleSource: string) {
  const progress = { produced: 0 }
  const pending: Promise<unknown>[] = []
  const fetchHandler = await loadWrapper(bundleSource)(
    async (_event, { streamCreator }) => {
      const sink = streamCreator.writeHeaders({ statusCode: 200, cookies: [], headers: {} })
      sink.on('error', () => {})
      while (progress.produced < TOTAL_BYTES) {
        progress.produced += CHUNK_BYTES
        if (!sink.write(Buffer.alloc(CHUNK_BYTES))) await once(sink, 'drain')
      }
      sink.end()
    },
    { convertFrom: async () => ({}) }
  )
  const response = await fetchHandler(new Request('https://petrios.example/api/sessions/s/documents/d'), {}, {
    waitUntil: (promise) => void pending.push(promise),
  })
  // The client has not read anything yet.
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { response, progress, producedWhileStalled: progress.produced, pending }
}

describe('OpenNext streaming backpressure patch', () => {
  it('patches the 4.1.9 response writer exactly once, idempotently', () => {
    const patched = patchOpenNextStreamingBackpressure(`before;${OPENNEXT_4_1_9_WRAPPER};after`)
    expect(patched).toContain(STREAMING_BACKPRESSURE_MARKER)
    expect(patched).toContain('pull(){petriosReleaseWrite()}')
    expect(patched.startsWith('before;') && patched.endsWith(';after')).toBe(true)
    expect(patchOpenNextStreamingBackpressure(patched)).toBe(patched)
  })

  it('fails loudly when OpenNext changes the writer or it appears twice', () => {
    expect(() => patchOpenNextStreamingBackpressure('export const nothing = 1')).toThrow(/exactly one/)
    expect(() => patchOpenNextStreamingBackpressure(`${OPENNEXT_4_1_9_WRAPPER};${OPENNEXT_4_1_9_WRAPPER}`)).toThrow(
      /found 2/
    )
    const changed = OPENNEXT_4_1_9_WRAPPER.replace('controller.enqueue(chunk)', 'controller.enqueue(chunk.slice())')
    expect(() => patchOpenNextStreamingBackpressure(changed)).toThrow(/exactly one/)
  })

  it('reproduces the unpatched writer queueing a whole body for a stalled client', async () => {
    const download = await startDownload(OPENNEXT_4_1_9_WRAPPER)
    expect(download.producedWhileStalled).toBe(TOTAL_BYTES)
    expect((await download.response.arrayBuffer()).byteLength).toBe(TOTAL_BYTES)
  })

  it('holds a stalled client to a bounded queue, then delivers every byte', async () => {
    const download = await startDownload(patchOpenNextStreamingBackpressure(OPENNEXT_4_1_9_WRAPPER))
    expect(download.producedWhileStalled).toBeLessThanOrEqual(256 * 1024)
    expect((await download.response.arrayBuffer()).byteLength).toBe(TOTAL_BYTES)
    await Promise.all(download.pending)
    expect(download.progress.produced).toBe(TOTAL_BYTES)
  })

  it('stops the producer when the client goes away', async () => {
    const download = await startDownload(patchOpenNextStreamingBackpressure(OPENNEXT_4_1_9_WRAPPER))
    const reader = download.response.body!.getReader()
    await reader.read()
    await reader.cancel(new Error('client disconnected'))
    const [outcome] = await Promise.allSettled(download.pending)
    expect(outcome.status).toBe('rejected')
    expect(download.progress.produced).toBeLessThan(TOTAL_BYTES)
  })
})
