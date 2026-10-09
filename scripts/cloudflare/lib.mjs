// Pure helpers for the Cloudflare Workers build/guard/deploy scripts (unit-tested).
import path from 'node:path'
import ts from 'typescript'

export const WRANGLER_CONFIG = 'wrangler.jsonc'

/** Parses JSONC (comments, trailing commas) the way the TypeScript config reader does. */
export function parseWranglerConfig(text) {
  const { config, error } = ts.parseConfigFileTextToJson(WRANGLER_CONFIG, text)
  if (error) {
    throw new Error(`${WRANGLER_CONFIG}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)
  }
  return config
}

export const NEXT_ENV_MODES = ['production', 'development', 'test']

/** Replacement for OpenNext's compiled .env snapshot: nothing reaches process.env from local files. */
export const EMPTY_NEXT_ENV_MODULE = NEXT_ENV_MODES.map((mode) => `export const ${mode} = {};\n`).join('')

/** `mode.NAME` for every variable next-env.mjs would copy into process.env. Never values. */
export function nextEnvKeyNames(nextEnvModule) {
  return NEXT_ENV_MODES.flatMap((mode) => {
    const vars = nextEnvModule[mode]
    if (!vars || typeof vars !== 'object') {
      throw new Error(`next-env.mjs no longer exports "${mode}"; the OpenNext output format changed`)
    }
    return Object.keys(vars).map((name) => `${mode}.${name}`)
  })
}

/** Every local dotenv file OpenNext or Next could read, plus any other `.env.*` variant. */
export function isLocalEnvFile(fileName) {
  return /^\.env(\..+)?$/.test(fileName) && fileName !== '.env.example'
}

export const MIN_LEAK_VALUE_LENGTH = 12

/**
 * Values whose presence in the upload would be a leak. Short values, and values
 * already public in the committed .env.example, cannot be told apart from code.
 * NEXT_PUBLIC_* values are public by design and are only reported as a warning.
 */
export function leakCandidates(entries, publicText) {
  const secret = []
  const browserPublic = []
  for (const { name, value } of entries) {
    if (value.length < MIN_LEAK_VALUE_LENGTH || publicText.includes(value)) continue
    const needles = [...new Set([value, JSON.stringify(value).slice(1, -1)])]
    ;(name.startsWith('NEXT_PUBLIC_') ? browserPublic : secret).push({ name, needles })
  }
  return { secret, browserPublic }
}

/** Names of candidates found in any of the scanned buffers, sorted. */
export function namesFoundIn(candidates, buffers) {
  const found = new Set()
  for (const buffer of buffers) {
    for (const { name, needles } of candidates) {
      if (!found.has(name) && needles.some((needle) => buffer.includes(needle))) found.add(name)
    }
  }
  return [...found].sort()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Staging APP_URL must be the Worker's own workers.dev origin: https, no
 * credentials, port, path, query or fragment (lib/app-url.ts and
 * lib/runtime-config.ts rules), and never localhost or another deployment.
 */
export function validateStagingAppUrl(value, workerName) {
  const expected = `https://${workerName}.<account-subdomain>.workers.dev`
  if (!value) return { error: `APP_URL is not set; pass APP_URL=${expected}` }
  let url
  try {
    url = new URL(value)
  } catch {
    return { error: `APP_URL is not a URL; expected ${expected}` }
  }
  if (url.protocol !== 'https:') return { error: 'APP_URL must use https' }
  if (url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    return { error: 'APP_URL must be an origin without credentials, port, path, query or fragment' }
  }
  const host = new RegExp(`^${escapeRegExp(workerName)}\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.workers\\.dev$`)
  if (!host.test(url.hostname)) return { error: `APP_URL must be ${expected}` }
  return { origin: url.origin }
}

/**
 * The top-level (staging) Worker must never run cron jobs, claim routes or
 * email real users. It serves the production database, so its email links
 * would point at workers.dev, and a delivery it marked SENT is never re-sent.
 */
export function stagingConfigProblems(config) {
  const problems = []
  // An absent key makes wrangler keep whatever schedules the Worker already has.
  if (!Array.isArray(config.triggers?.crons) || config.triggers.crons.length) {
    problems.push('top-level triggers.crons must be declared as []')
  }
  if (config.route || config.routes?.length) problems.push('top-level must not declare route/routes')
  if (config.workers_dev !== true) problems.push('top-level workers_dev must be true')
  if (config.vars?.CRON_ENABLED !== 'false') problems.push('top-level vars.CRON_ENABLED must be "false"')
  if (config.vars?.OUTBOUND_EMAIL_ENABLED !== 'false') {
    problems.push('top-level vars.OUTBOUND_EMAIL_ENABLED must be "false"')
  }
  if (config.vars?.TRUSTED_CLIENT_IP_HEADER !== 'cf-connecting-ip') {
    problems.push('top-level vars.TRUSTED_CLIENT_IP_HEADER must be "cf-connecting-ip"')
  }
  return problems
}

/** Names never set on Workers (docs/cloudflare-workers.md, "Configuration and secrets"). */
export const NEVER_SET_ON_WORKERS = [
  'SUPABASE_INTERNAL_URL',
  'AUTH_INTERNAL_URL',
  'STORAGE_INTERNAL_URL',
  'SELF_HOSTED_SETUP',
  'SETUP_TOKEN',
  'DATABASE_URL',
  'NEXTJS_ENV',
]

/** Origins lib/app-url.ts falls back to after APP_URL. A copied host env must not bring one along. */
export const APP_URL_FALLBACK_NAMES = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_BASE_URL',
  'NEXTAUTH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
  'RENDER_EXTERNAL_URL',
]

// dotenv's line grammar: the parser wrangler bundles for `--secrets-file`.
const DOTENV_LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm

/**
 * Variable names `wrangler deploy --secrets-file` would bind from `text`,
 * parsed as wrangler does: a JSON object, otherwise dotenv. Never returns values.
 */
export function secretsFileNames(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  if (json !== undefined) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { error: 'a JSON secrets file must be an object of NAME: value pairs' }
    }
    return { names: Object.keys(json) }
  }
  const names = [...text.replace(/\r\n?/g, '\n').matchAll(DOTENV_LINE)].map((match) => match[1])
  if (!names.length) return { error: 'the secrets file has no NAME=value entries' }
  return { names: [...new Set(names)] }
}

function isInside(root, filePath) {
  const relative = path.relative(root, filePath)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/**
 * Wrangler binds a `--secrets-file` after the config and `--var`, with no
 * collision check, so a name declared under top-level `vars` (APP_URL,
 * CRON_ENABLED, OUTBOUND_EMAIL_ENABLED) would silently replace the validated
 * value. Refuses those names, names never set on Workers, APP_URL fallbacks,
 * and a file inside the repository or named like a local env file (.dev.vars,
 * .env*). Reports names only.
 */
export function secretsFileProblems(names, config, { filePath, root }) {
  const problems = []
  const declaredVars = new Set(Object.keys(config.vars ?? {}))
  const refuse = (matching, reason) => {
    if (matching.length) problems.push(`the secrets file must not set ${matching.join(', ')} (${reason})`)
  }
  refuse(
    names.filter((name) => declaredVars.has(name)),
    'declared under vars in wrangler.jsonc; a same-named secret silently replaces it'
  )
  refuse(names.filter((name) => NEVER_SET_ON_WORKERS.includes(name)), 'never set on Workers')
  refuse(
    names.filter((name) => APP_URL_FALLBACK_NAMES.includes(name)),
    'an APP_URL fallback; cf:deploy:staging sets APP_URL'
  )
  if (isInside(root, filePath)) problems.push('keep the secrets file outside the repository')
  const baseName = path.basename(filePath)
  if (/^\.dev\.vars/.test(baseName) || isLocalEnvFile(baseName)) {
    problems.push(`do not pass a local env file (${baseName}); list only the Worker's secrets`)
  }
  return problems
}

/** Marker the patched OpenNext response writer carries into the Worker upload; the guard requires it. */
export const STREAMING_BACKPRESSURE_MARKER = 'petrios-opennext-backpressure'

/** Bytes the response body may queue before the writer withholds its write callback. */
export const RESPONSE_QUEUE_HIGH_WATER_MARK = 64 * 1024

// OpenNext 4.1.9's `cloudflare-node` response writer, as minified into
// .open-next/server-functions/default/handler.mjs. Its Writable completes every
// write at once and enqueues into a ReadableStream that has no pull(), so
// res.write() never reports backpressure: Next then reads a streamed body
// (session documents, recap audio) from upstream as fast as it arrives, and
// whatever a slow client has not read yet queues in isolate memory.
const OPENNEXT_RESPONSE_WRITER =
  /let controller,readable=new ReadableStream\(\{start\((\w+)\)\{controller=\1\}\}\),response=new Response\(readable,\{status:statusCode,headers:responseHeaders\}\);return resolveResponse\(response\),new Writable\(\{write\(chunk,encoding,callback\)\{try\{controller\.enqueue\(chunk\)\}catch\((\w+)\)\{return callback\(\2\)\}callback\(\)\},final\(callback\)\{controller\.close\(\),callback\(\)\},destroy\((\w+),callback\)\{if\(\3\)controller\.error\(\3\);else try\{controller\.close\(\)\}catch\{\}callback\(\3\)\}\}\)/g

/**
 * Restores backpressure in OpenNext's response writer: the response stream
 * gets a byte-sized queue limit, a write completes only while the queue is
 * below it, and pull() (the client reading) or cancel() (the client leaving)
 * releases a withheld write. Throws unless exactly one writer matches, so an
 * OpenNext upgrade cannot silently drop the patch. Idempotent.
 */
export function patchOpenNextStreamingBackpressure(source) {
  const matches = [...source.matchAll(OPENNEXT_RESPONSE_WRITER)]
  if (matches.length === 0 && source.includes(STREAMING_BACKPRESSURE_MARKER)) return source
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one OpenNext cloudflare-node response writer in handler.mjs, found ${matches.length}; ` +
        'the streaming backpressure patch (scripts/cloudflare/lib.mjs) must be revisited'
    )
  }
  return source.replace(
    OPENNEXT_RESPONSE_WRITER,
    (_, startArg, catchArg, destroyArg) =>
      'let controller,petriosPendingWrite=null,' +
      'petriosReleaseWrite=petriosError=>{let petriosCallback=petriosPendingWrite;petriosPendingWrite=null;petriosCallback&&petriosCallback(petriosError)},' +
      `readable=new ReadableStream({start(${startArg}){controller=${startArg}},` +
      'pull(){petriosReleaseWrite()},' +
      `cancel(petriosReason){petriosReleaseWrite(petriosReason instanceof Error?petriosReason:new Error("${STREAMING_BACKPRESSURE_MARKER}: response body cancelled"))}},` +
      `{highWaterMark:${RESPONSE_QUEUE_HIGH_WATER_MARK},size:petriosChunk=>petriosChunk&&typeof petriosChunk.byteLength=="number"?petriosChunk.byteLength:1}),` +
      'response=new Response(readable,{status:statusCode,headers:responseHeaders});' +
      'return resolveResponse(response),new Writable({' +
      `write(chunk,encoding,callback){try{controller.enqueue(chunk)}catch(${catchArg}){return callback(${catchArg})}if(controller.desiredSize>0)callback();else petriosPendingWrite=callback},` +
      'final(callback){controller.close(),callback()},' +
      `destroy(${destroyArg},callback){petriosReleaseWrite(${destroyArg}||void 0);if(${destroyArg})controller.error(${destroyArg});else try{controller.close()}catch{}callback(${destroyArg})}})`
  )
}
