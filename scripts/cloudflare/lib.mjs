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
 * It must also be a Worker of its own: deployed under the production Worker's
 * name it would replace the live version on petrios.uk (custom domains persist
 * across deploys) with email off, and its `crons: []` would clear production's
 * schedules.
 */
export function stagingConfigProblems(config) {
  const problems = []
  const productionName = config.env?.[PRODUCTION_ENV]?.name
  if (typeof config.name !== 'string' || !config.name) {
    problems.push('top-level name must be set')
  } else if (config.name === PRODUCTION_WORKER_NAME || config.name === productionName) {
    problems.push(
      `top-level name must not be the production Worker (${config.name}): a staging deploy would replace the live ` +
        'version on its custom domains, with email off, and clear its cron schedules'
    )
  }
  const services = Array.isArray(config.services) ? config.services : []
  if (
    services.length !== 1 ||
    services[0]?.binding !== SELF_REFERENCE_BINDING ||
    services[0]?.service !== config.name ||
    Object.keys(services[0]).length !== 2
  ) {
    problems.push(`top-level services must be exactly [{ binding: "${SELF_REFERENCE_BINDING}", service: "${config.name}" }]`)
  }
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
  // Staging serves the production database: rota availability (spec/14) stays off.
  if (config.vars?.[ROTA_KILL_SWITCH_VAR] !== 'false') {
    problems.push(`top-level vars.${ROTA_KILL_SWITCH_VAR} must be "false"`)
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
// Production (petrios.uk) — docs/cloudflare-workers.md, "Production".
// ---------------------------------------------------------------------------

/**
 * The one production wrangler environment: the Worker "petrios" on its custom
 * domains, running the crons, emailing real users.
 */
export const PRODUCTION_ENV = 'production'

/** The production Worker (env.production.name). No other configuration may deploy under this name. */
export const PRODUCTION_WORKER_NAME = 'petrios'

/**
 * Environments that must never come back. `production_preflight` deployed the
 * same Worker with no crons and email off; since 2026-10-11 the Worker serves
 * petrios.uk through custom domains, which persist across deploys, so such a
 * deploy would replace the live version for every user.
 */
export const RETIRED_PRODUCTION_ENVS = ['production_preflight']

/**
 * The complete set of Workers Custom Domains of the production Worker, as
 * attached on 2026-10-11. Wrangler publishes custom domains with
 * replace_state=true: a hostname missing from env.production.routes would be
 * detached on the next deploy and its Cloudflare-managed DNS record deleted.
 * www.petrios.uk is a zone-level 301 to the apex and is not one of them.
 */
export const PRODUCTION_CUSTOM_DOMAINS = ['petrios.uk', 'app.petrios.uk']

/** The host of APP_URL: every emailed link, certificate QR code and cron dispatch uses it. */
export const PRODUCTION_APP_HOST = 'petrios.uk'

/** The zone that holds every production custom domain (its plain routes are checked before a deploy). */
export const PRODUCTION_ZONE = 'petrios.uk'

/** Secrets the production Worker cannot run without (wrangler.jsonc secrets.required). */
export const PRODUCTION_REQUIRED_SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'PRIVACY_CONTROLLER_NAME',
  'PRIVACY_CONTACT_EMAIL',
]

/** Secrets set only when the feature is used (docs/cloudflare-workers.md, "Configuration and secrets"). */
export const PRODUCTION_OPTIONAL_SECRETS = [
  // Optional legal disclosures; /privacy shows them as "Not declared by this
  // deployment" until the controller supplies them.
  'PRIVACY_CONTROLLER_ADDRESS',
  'DATA_HOSTING_REGION',
  'DATA_TRANSFER_SAFEGUARDS',
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
  'ROTA_IDENTITY_SECRET',
]

/**
 * Names refused on the production Worker: lib/email.ts switches to SMTP
 * whenever SMTP_HOST is set, which would replace the required Resend path with
 * a transport never verified on Workers.
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
/** A custom domain: a bare lowercase hostname (no wildcard, scheme, port, path or trailing dot). */
const BARE_HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
/**
 * Rota availability kill switch (spec/14). Declared "false" at the top level
 * (staging, which serves the production database); env.production declares
 * "false" until the owner flips that value to "true" at go-live, after
 * migrations 063/064 and ROTA_IDENTITY_SECRET are in place.
 */
export const ROTA_KILL_SWITCH_VAR = 'ROTA_INTEGRATION_ENABLED'
const SELF_REFERENCE_BINDING = 'WORKER_SELF_REFERENCE'

/**
 * The vars a production version must carry, with the values only production
 * may have. A deploy checks them in wrangler.jsonc; rollback checks them in
 * the version it would restore (a version without them would stop the crons
 * or the email of the live site).
 */
export function productionVarProblems(vars, at) {
  const problems = []
  const value = (name) => (vars && Object.hasOwn(vars, name) ? vars[name] : undefined)
  const appUrl = validateProductionAppUrl(value('APP_URL'))
  if (appUrl.error) problems.push(`${at}: ${appUrl.error}`)
  else if (appUrl.host !== PRODUCTION_APP_HOST) {
    problems.push(
      `${at}.APP_URL must be https://${PRODUCTION_APP_HOST}, the origin of every emailed link, certificate QR code ` +
        `and cron dispatch (other custom domains serve the same Worker but are not the canonical origin)`
    )
  }
  if (value('CRON_ENABLED') !== 'true') problems.push(`${at}.CRON_ENABLED must be "true" (the only scheduler)`)
  if (value('OUTBOUND_EMAIL_ENABLED') !== 'true') {
    problems.push(`${at}.OUTBOUND_EMAIL_ENABLED must be "true" (the only host that emails real users)`)
  }
  if (value('TRUSTED_CLIENT_IP_HEADER') !== 'cf-connecting-ip') {
    problems.push(`${at}.TRUSTED_CLIENT_IP_HEADER must be "cf-connecting-ip"`)
  }
  if (value('HOSTING_PROVIDER') !== 'cloudflare-workers') problems.push(`${at}.HOSTING_PROVIDER must be "cloudflare-workers"`)
  if (!['false', 'true'].includes(value(ROTA_KILL_SWITCH_VAR))) {
    problems.push(`${at}.${ROTA_KILL_SWITCH_VAR} must be declared as "false" or "true"`)
  }
  return problems
}

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

function sameSet(a, b) {
  return a.length === b.length && new Set(a).size === a.length && a.every((item) => b.includes(item))
}

function show(value) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * env.production.routes must be exactly PRODUCTION_CUSTOM_DOMAINS, each as
 * `{ pattern: <bare hostname>, custom_domain: true }` and nothing else: no
 * plain route (string, or an object without custom_domain: true), no zone or
 * enabled/previews_enabled override, no wildcard, scheme, port or path.
 */
function customDomainRouteProblems(routes, at) {
  if (!Array.isArray(routes) || !routes.length) {
    return [`${at}.routes must list exactly the custom domains ${PRODUCTION_CUSTOM_DOMAINS.join(', ')}`]
  }
  const problems = []
  const patterns = routes.map((route) => (route && typeof route === 'object' && !Array.isArray(route) ? route.pattern : route))
  const missing = PRODUCTION_CUSTOM_DOMAINS.filter((hostname) => !patterns.includes(hostname))
  if (missing.length) {
    problems.push(
      `${at}.routes lacks the custom domain(s) ${missing.join(', ')}: wrangler publishes the list as the complete set, ` +
        'so a deploy would detach them and delete their DNS records'
    )
  }
  const unexpected = patterns.filter((pattern) => !PRODUCTION_CUSTOM_DOMAINS.includes(pattern))
  if (unexpected.length) {
    problems.push(
      `${at}.routes has unexpected entries ${unexpected.map(show).join(', ')}; production is exactly ` +
        `${PRODUCTION_CUSTOM_DOMAINS.join(', ')} (PRODUCTION_CUSTOM_DOMAINS in scripts/cloudflare/lib.mjs)`
    )
  }
  const repeated = [...new Set(patterns.filter((pattern, index) => patterns.indexOf(pattern) !== index))]
  if (repeated.length) problems.push(`${at}.routes lists ${repeated.map(show).join(', ')} more than once`)
  for (const route of routes) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      problems.push(`${at}.routes entry ${show(route)} is a plain route; production uses only custom domains`)
      continue
    }
    const label = show(route.pattern)
    if (route.custom_domain !== true) {
      problems.push(`route ${label} is a plain route (custom_domain is not true); production uses only custom domains`)
    }
    const extra = Object.keys(route).filter((key) => key !== 'pattern' && key !== 'custom_domain')
    if (extra.length) problems.push(`route ${label} must not set ${extra.join(', ')} (only pattern and custom_domain: true)`)
    if (typeof route.pattern !== 'string' || !BARE_HOSTNAME.test(route.pattern)) {
      problems.push(`route ${label} must be a bare lowercase hostname (no wildcard, scheme, port or path)`)
    }
  }
  return problems
}

/**
 * Everything that must hold before production is deployed: env.production is
 * the only environment besides the top level (a reappearing
 * env.production_preflight is refused), names the Worker PRODUCTION_WORKER_NAME
 * bound to itself on the pinned account, is served only through exactly
 * PRODUCTION_CUSTOM_DOMAINS, runs exactly CRON_SCHEDULE, keeps workers.dev and
 * preview URLs off, and carries the production vars and required secrets.
 */
export function productionConfigProblems(config, { expectedCrons }) {
  const problems = []
  const envs = config.env && typeof config.env === 'object' ? config.env : {}
  for (const retired of RETIRED_PRODUCTION_ENVS) {
    if (Object.hasOwn(envs, retired)) {
      problems.push(
        `env.${retired} must not exist: it deployed an email-off, cron-less version of the production Worker, ` +
          'which would now replace the live site on its custom domains'
      )
    }
  }
  const others = Object.keys(envs).filter((name) => name !== PRODUCTION_ENV && !RETIRED_PRODUCTION_ENVS.includes(name))
  if (others.length) {
    problems.push(`unexpected wrangler environments: ${others.join(', ')} (production is env.${PRODUCTION_ENV} only)`)
  }
  const env = envs[PRODUCTION_ENV]
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    problems.push(`env.${PRODUCTION_ENV} is missing`)
    return problems
  }

  const at = `env.${PRODUCTION_ENV}`
  const extra = Object.keys(env).filter((key) => !PRODUCTION_ENV_KEYS.includes(key))
  if (extra.length) {
    problems.push(`${at} declares ${extra.join(', ')}; production may set only ${PRODUCTION_ENV_KEYS.join(', ')}`)
  }
  if (typeof env.name !== 'string' || !env.name) problems.push(`${at}.name must be set`)
  else if (env.name === config.name) problems.push(`${at}.name must differ from the staging Worker (${config.name})`)
  else if (env.name !== PRODUCTION_WORKER_NAME) {
    problems.push(`${at}.name must be "${PRODUCTION_WORKER_NAME}", the Worker that serves the custom domains`)
  }
  if (typeof env.account_id !== 'string' || !ACCOUNT_ID.test(env.account_id)) {
    problems.push(`${at}.account_id must pin the Cloudflare account (32 lowercase hex characters)`)
  }
  const services = Array.isArray(env.services) ? env.services : []
  if (
    services.length !== 1 ||
    services[0]?.binding !== SELF_REFERENCE_BINDING ||
    services[0]?.service !== env.name ||
    Object.keys(services[0]).length !== 2
  ) {
    problems.push(`${at}.services must be exactly [{ binding: "${SELF_REFERENCE_BINDING}", service: "${env.name}" }]`)
  }
  if (env.workers_dev !== false) problems.push(`${at}.workers_dev must be false`)
  if (env.preview_urls !== false) problems.push(`${at}.preview_urls must be false`)

  if (env.route !== undefined) problems.push(`${at} must not use "route"; list the custom domains under "routes"`)
  problems.push(...customDomainRouteProblems(env.routes, at))

  // An absent key would keep whatever schedules the Worker has; [] would stop every job.
  if (!Array.isArray(env.triggers?.crons) || !sameSet(env.triggers.crons, expectedCrons)) {
    problems.push(`${at}.triggers.crons must equal cfw/cron.ts CRON_SCHEDULE (${expectedCrons.join(', ')})`)
  }

  problems.push(...productionVarProblems(env.vars, `${at}.vars`))

  const required = env.secrets?.required
  if (!Array.isArray(required)) {
    problems.push(`${at}.secrets.required must be declared`)
  } else {
    const missing = PRODUCTION_REQUIRED_SECRETS.filter((name) => !required.includes(name))
    if (missing.length) problems.push(`${at}.secrets.required lacks ${missing.join(', ')}`)
    const shadowed = required.filter((name) => Object.hasOwn(env.vars ?? {}, name))
    if (shadowed.length) problems.push(`${at}.secrets.required names vars: ${shadowed.join(', ')}`)
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

function hostnamesOf(entries) {
  return entries.map((entry) => (typeof entry?.hostname === 'string' ? entry.hostname : '(unnamed)'))
}

/**
 * Refusals before a production deploy, from the compute-only changeset that
 * wrangler itself requests before publishing custom domains
 * (`POST .../workers/scripts/:name/domains/changeset?replace_state=true`,
 * `{ added, removed, updated, conflicting }`) and the account's custom
 * domains. Wrangler then PUTs the domain records; when stdout is not a
 * terminal it sets override_existing_dns_record and override_existing_origin
 * without asking, and if the changeset request fails it carries on with an
 * empty one. So: refuse a removal (the hostname would be detached and its DNS
 * record deleted), a conflicting DNS record, and a configured hostname that
 * another Worker serves. An addition (a configured hostname not attached now)
 * or a settings update is reported, not refused.
 */
export function customDomainPreviewProblems(changeset, accountDomains, { workerName, hostnames }) {
  const problems = []
  const notes = []
  const lists = ['added', 'removed', 'updated', 'conflicting']
  const malformed = lists.filter((key) => !Array.isArray(changeset?.[key]))
  if (malformed.length) {
    problems.push(`the custom-domain changeset lacks ${malformed.join(', ')} (unexpected API response); nothing can be previewed`)
    return { problems, notes }
  }
  if (changeset.removed.length) {
    problems.push(
      `the deploy would DETACH ${hostnamesOf(changeset.removed).join(', ')} from "${workerName}" and delete the DNS ` +
        'record(s) Cloudflare manages for it (wrangler publishes custom domains with replace_state=true). ' +
        'If the hostname must stay, add it to env.production.routes and PRODUCTION_CUSTOM_DOMAINS; ' +
        'if it must go, detach it deliberately in the dashboard first'
    )
  }
  if (changeset.conflicting.length) {
    problems.push(
      `${hostnamesOf(changeset.conflicting).join(', ')} already has a DNS record that is not "${workerName}"'s custom ` +
        'domain, and wrangler replaces it without asking when it is not interactive. Inspect it in the dashboard ' +
        '(DNS -> Records) and resolve it by hand'
    )
  }
  const foreign = (Array.isArray(accountDomains) ? accountDomains : []).filter(
    (domain) => domain && hostnames.includes(domain.hostname) && domain.service !== workerName
  )
  if (foreign.length) {
    problems.push(
      `${foreign.map((domain) => `${domain.hostname} (Worker "${domain.service}")`).join(', ')} is a custom domain ` +
        `of another Worker, and wrangler moves it to "${workerName}" without asking when it is not interactive. ` +
        'Resolve it in the dashboard first'
    )
  }
  if (changeset.added.length) {
    notes.push(`the deploy will attach ${hostnamesOf(changeset.added).join(', ')} (configured but not attached now)`)
  }
  const modified = changeset.updated.filter((entry) => entry?.modified)
  if (modified.length) notes.push(`the deploy will update the settings of ${hostnamesOf(modified).join(', ')}`)
  return { problems, notes }
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
 * What must hold on Cloudflare for the production Worker, from the custom
 * domains, routes and cron schedules the API reports: exactly the configured
 * custom domains, no plain route, and exactly the configured schedules.
 *
 * @param {{ routes: { pattern: string }[], domains: { hostname: string }[], schedules: string[] }} state
 * @param {{ hostnames: string[], crons: string[] }} expected
 */
export function productionStateProblems(state, { hostnames, crons }) {
  const problems = []
  const attached = state.domains.map((domain) => domain.hostname)
  if (!sameSet(attached, hostnames)) {
    problems.push(`custom domains are [${attached.join(', ')}], expected [${hostnames.join(', ')}]`)
  }
  if (state.routes.length) {
    problems.push(`plain routes point at the Worker: ${state.routes.map((route) => route.pattern).join(', ')}`)
  }
  if (!sameSet(state.schedules, crons)) {
    problems.push(`cron schedules are [${state.schedules.join(', ')}], expected [${crons.join(', ')}]`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// Production rollback (the deployment `wrangler rollback` creates, never
// forced): code and vars only
// ---------------------------------------------------------------------------

/** A Worker version id (a UUID), as `wrangler rollback <version-id>` takes it. */
export const WORKER_VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Cloudflare's refusal of a deployment whose version has other secret values
 * than the Worker has now ("The following secrets have changed: ..."; wrangler
 * 4.149 CANNOT_ROLLBACK_WITH_MODIFIED_SECERT_CODE). It compares the secrets
 * themselves, however they were changed, which the deployment history cannot.
 */
export const SECRETS_CHANGED_ERROR_CODE = 10220

/**
 * Body of `POST .../workers/scripts/:name/deployments` that sends 100% of
 * traffic to one version: the request `wrangler rollback` makes. Callers send
 * it WITHOUT `?force=true`, so Cloudflare refuses a version whose secrets
 * changed since (SECRETS_CHANGED_ERROR_CODE) instead of restoring it with the
 * old values; a non-interactive `wrangler rollback` would confirm its own
 * "secrets have changed" prompt and retry with force.
 */
export function rollbackDeploymentBody(versionId, message) {
  return {
    strategy: 'percentage',
    versions: [{ version_id: versionId, percentage: 100 }],
    annotations: { 'workers/message': String(message).slice(0, 120) },
  }
}

/** The secret-change refusal among Cloudflare API errors (`[{ code, message }]`), or null. */
export function secretsChangedError(errors) {
  return (Array.isArray(errors) ? errors : []).find((error) => Number(error?.code) === SECRETS_CHANGED_ERROR_CODE) ?? null
}

/**
 * Deployments from `GET .../workers/scripts/:name/deployments`
 * (`{ deployments: [{ created_on, versions: [{ version_id, percentage }], annotations }] }`),
 * newest first; null when the response has another shape.
 */
export function deploymentsNewestFirst(result) {
  const list = Array.isArray(result?.deployments) ? result.deployments : Array.isArray(result) ? result : null
  if (!list) return null
  return list
    .filter((deployment) => deployment && typeof deployment.created_on === 'string' && Array.isArray(deployment.versions))
    .sort((a, b) => b.created_on.localeCompare(a.created_on))
}

function fullTrafficVersion(deployment) {
  return deployment.versions.find((version) => version?.percentage === 100)?.version_id ?? null
}

/** The version serving most of a deployment's traffic. */
function mainVersion(deployment) {
  const [top] = [...deployment.versions].sort((a, b) => (b?.percentage ?? 0) - (a?.percentage ?? 0))
  return top?.version_id ?? null
}

/**
 * What a rollback would do, from the deployment history (newest first): the
 * version serving now, the version to restore (the requested one, otherwise
 * the one wrangler picks: the 100% version of the newest earlier deployment),
 * and when that version stopped serving (null when no deployment in the
 * history sent it 100% of traffic). Whether secrets changed since is not read
 * from the history: deployment annotations do not show every secret change
 * (`versions secret put` + `versions deploy`, the dashboard), so the
 * un-forced deployment request leaves that to Cloudflare
 * (SECRETS_CHANGED_ERROR_CODE).
 */
export function rollbackPlan(deployments, requestedVersionId) {
  if (!Array.isArray(deployments) || !deployments.length) return { error: 'the Worker has no deployment history' }
  const current = deployments[0]
  const currentVersionId = mainVersion(current)
  let targetVersionId = requestedVersionId || null
  if (!targetVersionId) {
    targetVersionId = deployments.slice(1).map(fullTrafficVersion).find(Boolean) ?? null
    if (!targetVersionId) {
      return { error: 'no earlier deployment served a single version to 100% of traffic; pass the version id to restore' }
    }
  }
  if (fullTrafficVersion(current) === targetVersionId) {
    return { error: `version ${targetVersionId} is already deployed to 100% of traffic` }
  }
  const index = deployments.findIndex((deployment, position) => position > 0 && fullTrafficVersion(deployment) === targetVersionId)
  if (index === -1) return { currentVersionId, targetVersionId, targetServedUntil: null }
  return {
    currentVersionId,
    targetVersionId,
    // The deployment that replaced the target: when it stopped serving.
    targetServedUntil: deployments[index - 1].created_on,
  }
}

function versionBindings(version) {
  const bindings = version?.resources?.bindings
  return Array.isArray(bindings) ? bindings : null
}

/** Plain-text vars of a version (`GET .../versions/:id` resources.bindings). Secret bindings are skipped unread. */
export function versionPlainVars(version) {
  const bindings = versionBindings(version)
  if (!bindings) return null
  return Object.fromEntries(
    bindings
      .filter((binding) => binding?.type === 'plain_text' && typeof binding.name === 'string' && typeof binding.text === 'string')
      .map((binding) => [binding.name, binding.text])
  )
}

/** Names of a version's secret bindings (the API returns names only). */
export function versionSecretNames(version) {
  const bindings = versionBindings(version)
  if (!bindings) return null
  return bindings
    .filter((binding) => binding?.type === 'secret_text' && typeof binding.name === 'string')
    .map((binding) => binding.name)
    .sort()
}

/**
 * Reasons the planned rollback must not be requested: an unknown or failed
 * plan, a target that served no recent deployment to 100% of traffic, a
 * different set of secret names, or a target whose vars are not production's
 * (a version from the retired preflight phase has CRON_ENABLED and
 * OUTBOUND_EMAIL_ENABLED "false", and the stub `wrangler secret bulk` creates
 * has none): rolling back restores a version's code AND vars on the live
 * custom domains. Changed secret VALUES are Cloudflare's to refuse
 * (SECRETS_CHANGED_ERROR_CODE), because the request is never forced.
 */
export function rollbackProblems(plan, { targetVersion, currentVersion }) {
  if (plan.error) return [plan.error]
  const problems = []
  const target = plan.targetVersionId
  if (plan.targetServedUntil === null) {
    problems.push(
      `version ${target} served 100% of traffic in none of the deployments the API returned, so it is not a known ` +
        'production version'
    )
  }
  const targetSecrets = versionSecretNames(targetVersion)
  const currentSecrets = versionSecretNames(currentVersion)
  if (!targetSecrets || !currentSecrets) {
    problems.push('could not read the secret names of the current and target versions')
  } else {
    const lacking = currentSecrets.filter((name) => !targetSecrets.includes(name))
    const extra = targetSecrets.filter((name) => !currentSecrets.includes(name))
    if (lacking.length || extra.length) {
      problems.push(
        `version ${target} has different secrets from the current version` +
          (lacking.length ? `; it lacks ${lacking.join(', ')}` : '') +
          (extra.length ? `; it has ${extra.join(', ')}, which the current version does not` : '')
      )
    }
  }
  const vars = versionPlainVars(targetVersion)
  if (!vars) problems.push(`could not read the vars of version ${target}`)
  else problems.push(...productionVarProblems(vars, `version ${target} vars`))
  return problems
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
