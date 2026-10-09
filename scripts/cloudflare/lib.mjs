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
    'an APP_URL fallback; the deploy sets APP_URL'
  )
  if (isInside(root, filePath)) problems.push('keep the secrets file outside the repository')
  const baseName = path.basename(filePath)
  if (/^\.dev\.vars/.test(baseName) || isLocalEnvFile(baseName)) {
    problems.push(`do not pass a local env file (${baseName}); list only the Worker's secrets`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// Production (petrios.uk) — docs/cloudflare-workers.md, "Cutover".
// ---------------------------------------------------------------------------

/** Wrangler environment of the live phase: routes, crons, email on. */
export const PRODUCTION_ENV = 'production'
/** Same Worker, workers.dev only: no routes, no crons, email off. Rollback returns here. */
export const PREFLIGHT_ENV = 'production_preflight'

/** Secrets the production Worker cannot run without (wrangler.jsonc secrets.required). */
export const PRODUCTION_REQUIRED_SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'PRIVACY_CONTROLLER_NAME',
  'PRIVACY_CONTROLLER_ADDRESS',
  'PRIVACY_CONTACT_EMAIL',
  'DATA_HOSTING_REGION',
  'DATA_TRANSFER_SAFEGUARDS',
]

/** Secrets set only when the feature is used (docs/cloudflare-workers.md, "Configuration and secrets"). */
export const PRODUCTION_OPTIONAL_SECRETS = [
  'ATTENDANCE_RATE_LIMIT_SECRET',
  'INSTANCE_SIGNING_KEY',
  'GOOGLE_SITE_VERIFICATION',
  'OPS_ENABLED',
  'OPS_ASSISTANT_ENABLED',
  'TEACHER_INVITATIONS_RLS_LOCKED',
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_FALLBACKS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_TTS_MODEL',
  'OPENAI_TTS_VOICE',
  'TTS_PROVIDER',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_MODEL_ID',
  'JAAS_APP_ID',
  'JAAS_API_KEY_ID',
  'JAAS_PRIVATE_KEY',
  'JITSI_DOMAIN',
  'JITSI_APP_ID',
  'JITSI_APP_SECRET',
  'JITSI_JWT_AUDIENCE',
  'JITSI_JWT_SUBJECT',
  'OUTBOUND_EMAIL_ALLOWLIST',
  'APP_TIME_ZONE',
]

/**
 * Names refused on the production Worker although Render may have them:
 * lib/email.ts switches to SMTP whenever SMTP_HOST is set, which would replace
 * the required Resend path with a transport never verified on Workers.
 */
export const PRODUCTION_FORBIDDEN_SECRETS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE']

/** Groups a deployment must set completely or not at all (otherwise the feature reports a configuration error). */
export const ALL_OR_NONE_SECRET_GROUPS = [
  ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'],
  ['JAAS_APP_ID', 'JAAS_API_KEY_ID', 'JAAS_PRIVATE_KEY'],
  ['JITSI_APP_ID', 'JITSI_APP_SECRET'],
]

const PRODUCTION_ENV_KEYS = [
  'name',
  'account_id',
  'workers_dev',
  'preview_urls',
  'routes',
  'services',
  'triggers',
  'vars',
  'secrets',
]
const ACCOUNT_ID = /^[0-9a-f]{32}$/
const PRODUCTION_PHASE_VARS = ['CRON_ENABLED', 'OUTBOUND_EMAIL_ENABLED']
const SELF_REFERENCE_BINDING = 'WORKER_SELF_REFERENCE'

/**
 * Reads the cron expressions declared in cfw/cron.ts `CRON_SCHEDULE` from its
 * source (the scripts run on plain Node and cannot import TypeScript).
 */
export function cronScheduleExpressions(sourceText) {
  const source = ts.createSourceFile('cron.ts', sourceText, ts.ScriptTarget.Latest, true)
  let expressions = null
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'CRON_SCHEDULE') {
      let init = node.initializer
      while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) {
        init = init.expression
      }
      if (init && ts.isObjectLiteralExpression(init)) {
        expressions = init.properties.map((property) =>
          ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) ? property.name.text : null
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!expressions || expressions.includes(null) || !expressions.length) {
    throw new Error('cfw/cron.ts no longer declares CRON_SCHEDULE as an object literal with string keys')
  }
  return expressions
}

/**
 * Production APP_URL: an https origin on a real host. It is the origin of
 * every emailed link and certificate QR code, so never workers.dev, an IP
 * address, localhost, a port, a path, a query or credentials.
 */
export function validateProductionAppUrl(value) {
  if (!value) return { error: 'APP_URL is not set in the production vars' }
  let url
  try {
    url = new URL(value)
  } catch {
    return { error: 'APP_URL is not a URL' }
  }
  if (url.protocol !== 'https:') return { error: 'APP_URL must use https' }
  if (url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    return { error: 'APP_URL must be an origin without credentials, port, path, query or fragment' }
  }
  if (value !== url.origin && value !== `${url.origin}/`) return { error: `APP_URL must be written as ${url.origin}` }
  const host = url.hostname
  if (host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.startsWith('[')) {
    return { error: 'APP_URL must be the public domain, not localhost or an IP address' }
  }
  if (host.endsWith('.workers.dev') || !host.includes('.')) {
    return { error: 'APP_URL must be the public domain (petrios.uk), not a workers.dev or bare host' }
  }
  return { origin: url.origin, host }
}

/**
 * The live route patterns: APP_URL's host only. www.petrios.uk is answered by
 * Cloudflare itself with a 301 to the apex (no Render response), so it gets no
 * route and the cutover leaves it as it is.
 */
export function liveRoutePatterns(appHost) {
  return [`${appHost}/*`]
}

function sameSet(a, b) {
  return a.length === b.length && new Set(a).size === a.length && a.every((item) => b.includes(item))
}

function envConfig(config, name) {
  const env = config.env?.[name]
  return env && typeof env === 'object' && !Array.isArray(env) ? env : null
}

/**
 * Everything that must hold before either production phase is deployed. Both
 * environments name the same Worker (shared secrets), bind it to itself, carry
 * the same vars and required secrets, and differ only in routes, workers.dev,
 * cron schedules, CRON_ENABLED and OUTBOUND_EMAIL_ENABLED.
 */
export function productionConfigProblems(config, { expectedCrons }) {
  const problems = []
  const live = envConfig(config, PRODUCTION_ENV)
  const preflight = envConfig(config, PREFLIGHT_ENV)
  if (!live) problems.push(`env.${PRODUCTION_ENV} is missing`)
  if (!preflight) problems.push(`env.${PREFLIGHT_ENV} is missing`)
  if (!live || !preflight) return problems

  const others = Object.keys(config.env).filter((name) => name !== PRODUCTION_ENV && name !== PREFLIGHT_ENV)
  if (others.length) problems.push(`unexpected wrangler environments: ${others.join(', ')}`)

  for (const [envName, env] of [
    [PRODUCTION_ENV, live],
    [PREFLIGHT_ENV, preflight],
  ]) {
    const at = `env.${envName}`
    const extra = Object.keys(env).filter((key) => !PRODUCTION_ENV_KEYS.includes(key))
    if (extra.length) {
      problems.push(`${at} declares ${extra.join(', ')}; production phases may set only ${PRODUCTION_ENV_KEYS.join(', ')}`)
    }
    if (typeof env.name !== 'string' || !env.name) problems.push(`${at}.name must be set`)
    if (typeof env.account_id !== 'string' || !ACCOUNT_ID.test(env.account_id)) {
      problems.push(`${at}.account_id must pin the Cloudflare account (32 lowercase hex characters)`)
    }
    else if (env.name === config.name) problems.push(`${at}.name must differ from the staging Worker (${config.name})`)
    if (env.route !== undefined) problems.push(`${at} must not use "route"; use "routes"`)
    const services = Array.isArray(env.services) ? env.services : []
    if (
      services.length !== 1 ||
      services[0]?.binding !== SELF_REFERENCE_BINDING ||
      services[0]?.service !== env.name ||
      Object.keys(services[0]).length !== 2
    ) {
      problems.push(`${at}.services must be exactly [{ binding: "${SELF_REFERENCE_BINDING}", service: "${env.name}" }]`)
    }
    if (env.preview_urls !== false) problems.push(`${at}.preview_urls must be false`)
    if (env.vars?.TRUSTED_CLIENT_IP_HEADER !== 'cf-connecting-ip') {
      problems.push(`${at}.vars.TRUSTED_CLIENT_IP_HEADER must be "cf-connecting-ip"`)
    }
    if (env.vars?.HOSTING_PROVIDER !== 'cloudflare-workers') {
      problems.push(`${at}.vars.HOSTING_PROVIDER must be "cloudflare-workers"`)
    }
    const appUrl = validateProductionAppUrl(env.vars?.APP_URL)
    if (appUrl.error) problems.push(`${at}.vars: ${appUrl.error}`)
    const required = env.secrets?.required
    if (!Array.isArray(required)) {
      problems.push(`${at}.secrets.required must be declared`)
    } else {
      const missing = PRODUCTION_REQUIRED_SECRETS.filter((name) => !required.includes(name))
      if (missing.length) problems.push(`${at}.secrets.required lacks ${missing.join(', ')}`)
      const shadowed = required.filter((name) => Object.hasOwn(env.vars ?? {}, name))
      if (shadowed.length) problems.push(`${at}.secrets.required names vars: ${shadowed.join(', ')}`)
    }
  }

  // Shared identity: same Worker, same secrets, same non-phase configuration.
  if (live.name !== preflight.name) {
    problems.push(`both production environments must name the same Worker (${live.name} vs ${preflight.name})`)
  }
  if (live.account_id !== preflight.account_id) {
    problems.push('both production environments must pin the same account_id')
  }
  if (!sameSet(Object.keys(live.vars ?? {}), Object.keys(preflight.vars ?? {}))) {
    problems.push('both production environments must declare the same vars keys (environments do not inherit vars)')
  }
  for (const key of Object.keys(live.vars ?? {})) {
    if (!PRODUCTION_PHASE_VARS.includes(key) && live.vars[key] !== preflight.vars?.[key]) {
      problems.push(`vars.${key} must be identical in both production environments`)
    }
  }
  if (!sameSet(live.secrets?.required ?? [], preflight.secrets?.required ?? [])) {
    problems.push('both production environments must require the same secrets')
  }

  // Live: one route on APP_URL's host, crons = CRON_SCHEDULE, email and dispatch on.
  const appUrl = validateProductionAppUrl(live.vars?.APP_URL)
  if (live.workers_dev !== false) problems.push(`env.${PRODUCTION_ENV}.workers_dev must be false`)
  const routes = live.routes
  if (!Array.isArray(routes) || !routes.length) {
    problems.push(`env.${PRODUCTION_ENV}.routes must list the production routes`)
  } else if (appUrl.host) {
    const hosts = [appUrl.host]
    const expected = liveRoutePatterns(appUrl.host)
    const patterns = routes.map((route) => (route && typeof route === 'object' ? route.pattern : route))
    if (!sameSet(patterns, expected)) {
      problems.push(`env.${PRODUCTION_ENV}.routes must be exactly ${expected.join(' and ')} (APP_URL ${appUrl.origin})`)
    }
    for (const route of routes) {
      if (!route || typeof route !== 'object') {
        problems.push(`env.${PRODUCTION_ENV}.routes entries must be { pattern, zone_name } objects`)
        continue
      }
      const extraRouteKeys = Object.keys(route).filter((key) => key !== 'pattern' && key !== 'zone_name')
      if (extraRouteKeys.length) {
        problems.push(
          `route ${route.pattern} must not set ${extraRouteKeys.join(', ')} (custom_domain would rewrite DNS records)`
        )
      }
      const zone = route.zone_name
      if (typeof zone !== 'string' || !zone) {
        problems.push(`route ${route.pattern} must name its zone_name`)
      } else if (!hosts.every((host) => host === zone || host.endsWith(`.${zone}`))) {
        problems.push(`route ${route.pattern}: zone_name ${zone} does not contain ${hosts.join(' and ')}`)
      }
    }
    const zones = new Set(routes.map((route) => route?.zone_name))
    if (zones.size > 1) problems.push(`env.${PRODUCTION_ENV}.routes must all use one zone_name`)
  }
  if (!Array.isArray(live.triggers?.crons) || !sameSet(live.triggers.crons, expectedCrons)) {
    problems.push(`env.${PRODUCTION_ENV}.triggers.crons must equal cfw/cron.ts CRON_SCHEDULE (${expectedCrons.join(', ')})`)
  }
  if (live.vars?.CRON_ENABLED !== 'true') problems.push(`env.${PRODUCTION_ENV}.vars.CRON_ENABLED must be "true"`)
  if (live.vars?.OUTBOUND_EMAIL_ENABLED !== 'true') {
    problems.push(`env.${PRODUCTION_ENV}.vars.OUTBOUND_EMAIL_ENABLED must be "true"`)
  }

  // Preflight: workers.dev only, schedules cleared, nothing dispatched or emailed.
  if (preflight.workers_dev !== true) problems.push(`env.${PREFLIGHT_ENV}.workers_dev must be true`)
  if (!Array.isArray(preflight.routes) || preflight.routes.length) {
    problems.push(`env.${PREFLIGHT_ENV}.routes must be declared as [] (an absent key is inherited)`)
  }
  // An absent key makes wrangler keep whatever schedules the Worker already has.
  if (!Array.isArray(preflight.triggers?.crons) || preflight.triggers.crons.length) {
    problems.push(`env.${PREFLIGHT_ENV}.triggers.crons must be declared as []`)
  }
  if (preflight.vars?.CRON_ENABLED !== 'false') problems.push(`env.${PREFLIGHT_ENV}.vars.CRON_ENABLED must be "false"`)
  if (preflight.vars?.OUTBOUND_EMAIL_ENABLED !== 'false') {
    problems.push(`env.${PREFLIGHT_ENV}.vars.OUTBOUND_EMAIL_ENABLED must be "false"`)
  }
  return problems
}

/**
 * Secret NAMES from `wrangler secret list --format json` output
 * (`[{ "name": ..., "type": "secret_text" }]`). The API never returns values.
 */
export function parseSecretList(stdout) {
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start === -1 || end < start) return { error: 'wrangler secret list printed no JSON list' }
  let list
  try {
    list = JSON.parse(stdout.slice(start, end + 1))
  } catch {
    return { error: 'wrangler secret list printed malformed JSON' }
  }
  if (!Array.isArray(list) || list.some((entry) => typeof entry?.name !== 'string')) {
    return { error: 'wrangler secret list returned an unexpected shape' }
  }
  return { names: list.map((entry) => entry.name).sort() }
}

/**
 * Problems with the secrets stored on the production Worker, by name only:
 * missing required ones, and names that shadow a var, are never set on
 * Workers, or are APP_URL fallbacks.
 */
export function productionSecretNameProblems(names, env, envName) {
  const problems = []
  const missing = (env.secrets?.required ?? []).filter((name) => !names.includes(name))
  if (missing.length) {
    problems.push(
      `required secrets missing on ${env.name}: ${missing.join(', ')}. ` +
        `Add them with: npx wrangler secret put <NAME> --env ${envName}`
    )
  }
  const shadowing = names.filter((name) => Object.hasOwn(env.vars ?? {}, name))
  if (shadowing.length) {
    problems.push(
      `secrets ${shadowing.join(', ')} shadow vars declared in wrangler.jsonc. ` +
        `Delete each with: npx wrangler secret delete <NAME> --env ${envName}`
    )
  }
  const forbidden = names.filter((name) => NEVER_SET_ON_WORKERS.includes(name) || APP_URL_FALLBACK_NAMES.includes(name))
  if (forbidden.length) {
    problems.push(
      `secrets ${forbidden.join(', ')} must not exist on Workers (never-set names or APP_URL fallbacks). ` +
        `Delete each with: npx wrangler secret delete <NAME> --env ${envName}`
    )
  }
  const smtp = names.filter((name) => PRODUCTION_FORBIDDEN_SECRETS.includes(name))
  if (smtp.length) {
    problems.push(
      `secrets ${smtp.join(', ')} would switch production email from Resend to SMTP (unverified on Workers). ` +
        `Delete each with: npx wrangler secret delete <NAME> --env ${envName}`
    )
  }
  return problems
}

/**
 * Reads a production secrets file (a JSON object, as in
 * production-secrets.template.json) into names and value kinds. Values never
 * leave this function.
 */
export function parseProductionSecretsFile(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { error: 'the production secrets file must be JSON (copy production-secrets.template.json)' }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'the production secrets file must be a JSON object of NAME: value pairs' }
  }
  return {
    entries: Object.entries(json).map(([name, value]) => ({
      name,
      kind: typeof value !== 'string' ? 'non-string' : value.trim() === '' ? 'empty' : 'set',
    })),
  }
}

/**
 * Checks a filled production secrets file before `wrangler secret bulk`:
 * the staging file rules (no vars names, never-set names, APP_URL fallbacks,
 * repository paths or local env files), every required name present, and no
 * empty or non-string value (bulk would store "" or delete a secret for null).
 * Returns problems and, separately, unknown names to double-check.
 */
export function productionSecretsFileProblems(entries, env, location) {
  const names = entries.map((entry) => entry.name)
  const problems = secretsFileProblems(names, env, location)
  const missing = (env.secrets?.required ?? []).filter((name) => !names.includes(name))
  if (missing.length) problems.push(`the secrets file lacks required ${missing.join(', ')}`)
  const smtp = names.filter((name) => PRODUCTION_FORBIDDEN_SECRETS.includes(name))
  if (smtp.length) {
    problems.push(`remove ${smtp.join(', ')}: SMTP_HOST switches production email from Resend to SMTP (unverified on Workers)`)
  }
  const empty = entries.filter((entry) => entry.kind === 'empty').map((entry) => entry.name)
  if (empty.length) {
    problems.push(`remove or fill the empty values: ${empty.join(', ')} (an empty secret is stored as "")`)
  }
  const nonString = entries.filter((entry) => entry.kind === 'non-string').map((entry) => entry.name)
  if (nonString.length) {
    problems.push(`values must be strings: ${nonString.join(', ')} (wrangler deletes a secret given null)`)
  }
  for (const group of ALL_OR_NONE_SECRET_GROUPS) {
    const present = group.filter((name) => names.includes(name))
    if (present.length && present.length !== group.length) {
      problems.push(`set all of ${group.join(', ')} or none (only ${present.join(', ')} present)`)
    }
  }
  if (
    ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'].every((name) => names.includes(name)) &&
    !names.includes('LLM_PROVIDER')
  ) {
    problems.push('both LLM keys plus OPENAI_BASE_URL disable AI unless LLM_PROVIDER pins one')
  }
  const known = [...PRODUCTION_REQUIRED_SECRETS, ...PRODUCTION_OPTIONAL_SECRETS, ...PRODUCTION_FORBIDDEN_SECRETS]
  const unknown = names.filter((name) => !known.includes(name))
  return { problems, unknown }
}

/** Routes in a zone's `GET /zones/:id/workers/routes` result that send traffic to `scriptName`. */
export function routesForScript(routes, scriptName) {
  return routes.filter((route) => route && route.script === scriptName)
}

/** Custom domains in `GET /accounts/:id/workers/domains` that serve `scriptName`. */
export function domainsForService(domains, scriptName) {
  return (Array.isArray(domains) ? domains : []).filter((domain) => domain && domain.service === scriptName)
}

/** Cron expressions from `GET .../workers/scripts/:name/schedules` (`{ schedules: [{ cron }] }`). */
export function scheduleExpressions(result) {
  const schedules = Array.isArray(result) ? result : (result?.schedules ?? [])
  return schedules.map((entry) => entry?.cron).filter((cron) => typeof cron === 'string')
}

/**
 * The version id `wrangler deploy` reported in its output file
 * (WRANGLER_OUTPUT_FILE_PATH, one JSON entry per line), or null. Wrangler
 * exits 0 with a null version id when the operator declines one of its
 * "Would you like to continue?" prompts, so success needs a version id.
 */
export function deployedVersionId(outputText) {
  let versionId = null
  for (const line of outputText.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry?.type === 'deploy') versionId = typeof entry.version_id === 'string' && entry.version_id ? entry.version_id : null
    } catch {
      // not an output entry
    }
  }
  return versionId
}

/**
 * What must hold on Cloudflare after a deploy, from the routes, custom domains
 * and cron schedules the API reports for the Worker. Live: exactly its routes
 * and CRON_SCHEDULE. Preflight (and rollback): nothing attached, nothing scheduled.
 *
 * @param {'live' | 'preflight'} phase
 * @param {{ routes: { pattern: string }[], domains: { hostname: string }[], schedules: string[] }} state
 * @param {{ routePatterns?: string[], crons?: string[] }} [expected]
 */
export function productionStateProblems(phase, state, { routePatterns = [], crons = [] } = {}) {
  const problems = []
  const patterns = state.routes.map((route) => route.pattern)
  const hostnames = state.domains.map((domain) => domain.hostname)
  if (hostnames.length) problems.push(`custom domains are attached: ${hostnames.join(', ')}`)
  if (phase === 'live') {
    if (!sameSet(patterns, routePatterns)) {
      problems.push(`routes are [${patterns.join(', ')}], expected [${routePatterns.join(', ')}]`)
    }
    if (!sameSet(state.schedules, crons)) {
      problems.push(`cron schedules are [${state.schedules.join(', ')}], expected [${crons.join(', ')}]`)
    }
  } else {
    if (patterns.length) problems.push(`routes are still attached: ${patterns.join(', ')}`)
    if (state.schedules.length) problems.push(`cron schedules remain: ${state.schedules.join(', ')}`)
  }
  return problems
}

/** Longest a Worker cron invocation already in progress can keep running (Cron Trigger wall-time limit). */
export const CRON_RUN_MAX_MINUTES = 15

/** "YYYY-MM-DD HH:MM UTC" by which every Worker cron run started before `clearedAt` has ended. */
export function renderResumeTime(clearedAt) {
  const iso = new Date(clearedAt.getTime() + CRON_RUN_MAX_MINUTES * 60_000 + 59_999).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/** Paths from `git status --porcelain=v1` output (tracked changes and untracked files). */
export function dirtyPaths(porcelain) {
  return porcelain
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim())
    .map((line) => line.slice(3))
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
