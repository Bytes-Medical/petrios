// Production (petrios.uk) on Cloudflare Workers. docs/cloudflare-workers.md, "Production".
//
//   npm run cf:deploy:production -- check-secrets <file>    validate a filled secrets file (local only)
//   npm run cf:deploy:production -- secrets <file>          check-secrets, then wrangler secret bulk (live at once)
//   npm run cf:deploy:production -- deploy [--dry-run]      check, preview, build, deploy env.production, confirm
//   npm run cf:deploy:production -- rollback [<version-id>] restore an earlier version: code and vars only
//
// Production is ONE Worker ("petrios", env.production), served only through
// the Workers Custom Domains listed in env.production.routes (petrios.uk and
// app.petrios.uk) and the only scheduler of the cron jobs. Custom domains and
// cron schedules are not part of a Worker version: a deploy publishes them
// again from wrangler.jsonc, and a rollback never touches them. Wrangler
// publishes custom domains as the complete set (replace_state=true) and, when
// it is not interactive (no terminal, or a CI variable), overrides a
// conflicting DNS record or another Worker's hostname without asking, so
// deploy previews that change with the same compute-only API call, refuses
// those cases before building. Wrangler runs with CI=false, so an operator in
// a terminal still gets its prompts; a non-interactive run (an agent, a pipe)
// relies on that preview, taken seconds before the upload. Rollback sends the deployment request `wrangler
// rollback` sends, but never forced, so Cloudflare refuses it when secrets
// changed since the version served. Wrangler can exit 0 without deploying (a
// declined prompt), so every deploy and rollback is confirmed afterwards from
// the Cloudflare API, read with the operator's own wrangler credentials.
// Secret values and credentials are never printed. The 2026-10 cutover phases
// (preflight, live) and everything Render-related are retired and refuse.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT, captureWrangler, fail, log, readWranglerConfig, runBuild, runWrangler } from './tasks.mjs'
import {
  PRODUCTION_ENV,
  PRODUCTION_ZONE,
  ROTA_KILL_SWITCH_VAR,
  WORKER_VERSION_ID,
  cronScheduleExpressions,
  customDomainPreviewProblems,
  deployedVersionId,
  deploymentsNewestFirst,
  dirtyPaths,
  domainsForService,
  parseProductionSecretsFile,
  parseSecretList,
  productionConfigProblems,
  productionSecretNameProblems,
  productionSecretsFileProblems,
  productionStateProblems,
  rollbackDeploymentBody,
  rollbackPlan,
  rollbackProblems,
  routesForScript,
  scheduleExpressions,
  secretsChangedError,
  validateProductionAppUrl,
  versionPlainVars,
} from './lib.mjs'

const DRY_RUN = '--dry-run'
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
const SECRETS_EXAMPLE = '~/petrios-production-secrets.json'
const CLEAN_CHECKOUT =
  'git fetch origin && git worktree add --detach ../petrios-deploy origin/main && cd ../petrios-deploy && npm ci'
/** What an API token (instead of wrangler login) needs for this script and the wrangler commands it runs. */
const API_TOKEN_PERMISSIONS =
  'Account: Workers Scripts Edit; Zone petrios.uk: Zone Read and Workers Routes Read. No DNS permission: ' +
  'Workers Custom Domains manage their own DNS records'
const RETIRED_PHASES =
  'production moved to Cloudflare Workers Custom Domains (petrios.uk, app.petrios.uk) on 2026-10-11 and Render is ' +
  'retired, so there is no preflight phase and no hand-over to Render any more. Deploy with ' +
  'npm run cf:deploy:production -- deploy --dry-run, then npm run cf:deploy:production -- deploy ' +
  '(docs/cloudflare-workers.md, "Production")'
const USAGE = [
  'usage: npm run cf:deploy:production -- <command>',
  '  check-secrets <file>      validate a filled secrets file (names only; contacts nothing)',
  '  secrets <file>            check-secrets, then wrangler secret bulk to the live Worker (a new version at once)',
  `  deploy ${DRY_RUN}          every check, the custom-domain preview and cf:build, then wrangler deploy --dry-run`,
  '  deploy                    the same, then deploy env.production and confirm it from the Cloudflare API',
  '  rollback [<version-id>]   restore an earlier version (default: the previous one); code and vars only',
].join('\n')
/** What to do about secrets while production runs a rolled-back version. */
const SECRETS_AFTER_ROLLBACK =
  'Do NOT use wrangler versions secret put/bulk and wrangler versions deploy instead: they copy the newest UPLOADED ' +
  'version, which is the code you rolled back from, and deploying that copy undoes the rollback. Ship a fixed main ' +
  `first (npm run cf:deploy:production -- deploy), then change the secret with npx wrangler secret put <NAME> --env ` +
  `${PRODUCTION_ENV} or npm run cf:deploy:production -- secrets <file>.`

/** An expected, actionable refusal: printed without a stack trace. */
class Refusal extends Error {}

function refuse(message) {
  throw new Refusal(message)
}

function expectArgs(command, args, allowed) {
  const unexpected = args.filter((arg) => !allowed.includes(arg))
  if (unexpected.length) refuse(`${command} does not accept ${unexpected.join(' ')}\n${USAGE}`)
}

// ---------------------------------------------------------------------------
// Configuration, source tree and secrets (no Cloudflare state changes)
// ---------------------------------------------------------------------------

/**
 * Every wrangler child and API call uses the account pinned in wrangler.jsonc.
 * A different CLOUDFLARE_ACCOUNT_ID in the shell is refused, not overridden.
 */
function pinAccount(accountId) {
  const shell = process.env.CLOUDFLARE_ACCOUNT_ID
  if (shell && shell !== accountId) {
    refuse(
      `CLOUDFLARE_ACCOUNT_ID in your shell (${shell}) differs from the account pinned in wrangler.jsonc (${accountId}). ` +
        'Run `unset CLOUDFLARE_ACCOUNT_ID` and retry.'
    )
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId
}

function loadProductionConfig() {
  const config = readWranglerConfig()
  const expectedCrons = cronScheduleExpressions(fs.readFileSync(path.join(ROOT, 'cfw', 'cron.ts'), 'utf8'))
  const problems = productionConfigProblems(config, { expectedCrons })
  if (problems.length) {
    refuse(`wrangler.jsonc is not deployable to production:\n  - ${problems.join('\n  - ')}`)
  }
  const env = config.env[PRODUCTION_ENV]
  pinAccount(env.account_id)
  return {
    env,
    workerName: env.name,
    accountId: env.account_id,
    zoneName: PRODUCTION_ZONE,
    appUrl: validateProductionAppUrl(env.vars.APP_URL),
    hostnames: env.routes.map((route) => route.pattern),
    crons: env.triggers.crons,
  }
}

/** Production takes APP_URL from wrangler.jsonc only; a staging value left in the shell must not confuse anyone. */
function checkShellAppUrl(appUrl) {
  const shell = process.env.APP_URL
  if (shell && shell.replace(/\/$/, '') !== appUrl.origin) {
    refuse(
      `APP_URL in your shell (${shell}) differs from wrangler.jsonc (${appUrl.origin}). ` +
        'Production reads APP_URL only from wrangler.jsonc; run `unset APP_URL` and retry.'
    )
  }
}

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

function gitRev(rev) {
  const result = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
  return result.status === 0 ? result.stdout.trim() : null
}

/**
 * Production deploys exactly one commit: the project must be a git checkout
 * (or worktree) of its own, clean of tracked changes and untracked files.
 */
function checkSourceTree() {
  const top = git(['rev-parse', '--show-toplevel'])
  if (top.error) refuse(`git could not be run (${top.error.message}); production deploys only from a clean git checkout`)
  let isCheckout = false
  if (top.status === 0) {
    try {
      isCheckout = fs.realpathSync(top.stdout.trim()) === fs.realpathSync(ROOT)
    } catch {
      isCheckout = false
    }
  }
  if (!isCheckout) {
    refuse(
      `${ROOT} is not a git checkout of its own, so the deployed code would not be a known commit. ` +
        `Deploy from a clean checkout instead, for example: ${CLEAN_CHECKOUT}`
    )
  }
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  if (status.status !== 0) refuse('git status failed; run it yourself to see why')
  const dirty = dirtyPaths(status.stdout)
  if (dirty.length) {
    const shown = dirty.slice(0, 10).join(', ') + (dirty.length > 10 ? ` and ${dirty.length - 10} more` : '')
    refuse(
      `the working tree has uncommitted or untracked files: ${shown}. ` +
        `Production deploys exactly one commit: commit or remove them, or deploy from a clean checkout (${CLEAN_CHECKOUT}).`
    )
  }
  const head = gitRev('HEAD')
  if (!head) refuse('git rev-parse HEAD failed; run it yourself to see why')
  const subject = git(['log', '-1', '--format=%s']).stdout.trim()
  const mains = ['main', 'origin/main'].filter((rev) => gitRev(rev) === head)
  log(`deploying commit ${head}${mains.length ? ` (= ${mains.join(', ')})` : ''}: ${subject}`)
  if (!mains.length) log('warning: HEAD is neither main nor origin/main; production normally deploys main')
  return { label: head.slice(0, 12) }
}

/**
 * Read-only `wrangler secret list`: names only (the API never returns values).
 * Refuses when the Worker cannot be listed: it has existed since the cutover,
 * so a missing Worker means the wrong account or login, and wrangler must
 * never be allowed to create an empty "petrios".
 */
function storedSecretNames(env) {
  const listed = captureWrangler(['secret', 'list', '--format', 'json'], PRODUCTION_ENV)
  if (!listed.ok) {
    refuse(
      `could not list the secrets of the "${env.name}" Worker (read-only wrangler secret list --env ${PRODUCTION_ENV}). ` +
        'Run npx wrangler login, and check that npx wrangler whoami shows the account pinned in wrangler.jsonc. ' +
        `The production Worker exists; if wrangler offers to create "${env.name}", answer no.`
    )
  }
  const parsed = parseSecretList(listed.stdout)
  if (parsed.error) refuse(parsed.error)
  return parsed.names
}

function checkWorkerSecrets(env) {
  const names = storedSecretNames(env)
  const problems = productionSecretNameProblems(names, env, PRODUCTION_ENV)
  if (problems.length) refuse(problems.join('\n  '))
  const optional = names.filter((name) => !env.secrets.required.includes(name))
  log(`Worker secrets (names only): all ${env.secrets.required.length} required present; optional: ${optional.join(', ') || 'none'}`)
}

function checkSecretsFile(argument, env) {
  if (!argument) refuse(`pass the path of your filled secrets file, for example ${SECRETS_EXAMPLE}`)
  let filePath
  let text
  try {
    filePath = fs.realpathSync(path.resolve(argument))
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    refuse(`cannot read the secrets file ${argument}`)
  }
  const parsed = parseProductionSecretsFile(text)
  if (parsed.error) refuse(parsed.error)
  const { problems, unknown } = productionSecretsFileProblems(parsed.entries, env, {
    filePath,
    root: fs.realpathSync(ROOT),
  })
  if (unknown.length) log(`warning: names Petrios does not read (check the spelling): ${unknown.join(', ')}`)
  if (problems.length) refuse(`the secrets file is not ready:\n  - ${problems.join('\n  - ')}`)
  if (process.platform !== 'win32' && fs.statSync(filePath).mode & 0o077) {
    log(`warning: ${filePath} is readable by other users; run chmod 600 on it`)
  }
  const names = parsed.entries.map((entry) => entry.name)
  log(`secrets file OK: ${names.join(', ')}`)
  return { filePath, names }
}

// ---------------------------------------------------------------------------
// Cloudflare API (read-only, plus the compute-only custom-domain changeset),
// with the operator's wrangler login
// ---------------------------------------------------------------------------

/** Headers for the Cloudflare API from `wrangler auth token --json`. Never printed. */
function cloudflareAuthHeaders() {
  const result = captureWrangler(['auth', 'token', '--json'])
  if (!result.ok) refuse('could not read your wrangler credentials; run npx wrangler login and retry')
  let auth
  try {
    auth = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1))
  } catch {
    refuse('wrangler auth token --json printed something unexpected; run npx wrangler login and retry')
  }
  if (auth?.type === 'api_key' && auth.key && auth.email) return { 'X-Auth-Key': auth.key, 'X-Auth-Email': auth.email }
  if (typeof auth?.token === 'string' && auth.token) return { Authorization: `Bearer ${auth.token}` }
  refuse('wrangler returned no usable credentials; run npx wrangler login and retry')
}

/** A failed Cloudflare API call, with the API's `errors` (`[{ code, message }]`; never credentials). */
class CloudflareApiError extends Error {
  constructor(message, errors) {
    super(message)
    this.errors = errors
  }
}

async function cloudflareApi(headers, method, pathname, body) {
  const response = await fetch(`${CLOUDFLARE_API}${pathname}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || !payload?.success) {
    const errors = Array.isArray(payload?.errors) ? payload.errors : []
    const detail = errors.map((error) => `${error?.code}: ${error?.message}`).join('; ') || `HTTP ${response.status}`
    throw new CloudflareApiError(`${method} ${pathname.split('?')[0]} failed (${detail})`, errors)
  }
  return payload.result
}

/** Credentials plus the zone that holds the custom domains, in the pinned account. */
async function connectCloudflare({ workerName, accountId, zoneName }) {
  const headers = cloudflareAuthHeaders()
  const query = new URLSearchParams({ name: zoneName, 'account.id': accountId })
  const zones = await cloudflareApi(headers, 'GET', `/zones?${query}`)
  if (!Array.isArray(zones) || zones.length !== 1) {
    refuse(
      `expected the zone ${zoneName} in account ${accountId} (wrangler.jsonc account_id), found ${zones?.length ?? 0}. ` +
        'Check npx wrangler whoami and the account_id in wrangler.jsonc.'
    )
  }
  return { headers, zoneId: zones[0].id, accountId, workerName, zoneName }
}

async function accountCustomDomains(cf) {
  const domains = await cloudflareApi(cf.headers, 'GET', `/accounts/${cf.accountId}/workers/domains`)
  return Array.isArray(domains) ? domains : []
}

async function workerSchedules(cf) {
  return scheduleExpressions(
    await cloudflareApi(cf.headers, 'GET', `/accounts/${cf.accountId}/workers/scripts/${cf.workerName}/schedules`)
  )
}

/** The Worker's custom domains (and the account's), its plain routes in the zone, and its cron schedules. */
async function readWorkerState(cf) {
  const routes = await cloudflareApi(cf.headers, 'GET', `/zones/${cf.zoneId}/workers/routes`)
  const accountDomains = await accountCustomDomains(cf)
  return {
    routes: routesForScript(Array.isArray(routes) ? routes : [], cf.workerName),
    domains: domainsForService(accountDomains, cf.workerName),
    accountDomains,
    schedules: await workerSchedules(cf),
  }
}

/**
 * The custom-domain diff a deploy would apply, from the request wrangler sends
 * before publishing (`publishCustomDomains`): it computes the changeset and
 * applies nothing.
 */
async function previewCustomDomains(cf, hostnames) {
  return cloudflareApi(
    cf.headers,
    'POST',
    `/accounts/${cf.accountId}/workers/scripts/${cf.workerName}/domains/changeset?replace_state=true`,
    hostnames.map((hostname) => ({ hostname }))
  )
}

// ---------------------------------------------------------------------------
// deploy [--dry-run]
// ---------------------------------------------------------------------------

function printDeployChecklist({ workerName, hostnames, crons }, versionId) {
  console.log(`
[cf] DEPLOYED version ${versionId} of "${workerName}": custom domains ${hostnames.join(', ')}, no plain routes,
     ${crons.length} cron schedules (confirmed from the Cloudflare API).
  1. Health, on every host (expect {"status":"ok","db":"ok"}):
${hostnames.map((hostname) => `       curl -s https://${hostname}/api/health`).join('\n')}
  2. Logs:   npx wrangler tail --env ${PRODUCTION_ENV} --format pretty   (errors only: --status error)
  3. Crons:  the next runs print '"<expression>" @ <time> - Ok' and a '[cron] ... HTTP 200' line in the tail:
             recall-awards (:05, :20, :35, :50), session-reminders (:00) and post-session-reports (:15), then the
             daily jobs (06:30, 08:00 UTC) and ops-weekly (Monday 07:00 UTC).
  4. If the new version misbehaves: npm run cf:deploy:production -- rollback   (code and vars; domains and crons stay)`)
}

/** A deploy that is not confirmed: say what is serving and what to do. */
function reportUnconfirmedDeploy(target, { problems, after }) {
  fail(`the deploy is NOT confirmed:\n  - ${problems.join('\n  - ')}`)
  const advice = [
    'Custom domains and cron schedules persist across deploys, so unless the state above says otherwise the Worker ' +
      `still serves ${target.hostnames.join(' and ')} and runs the jobs. A rejected upload or a declined ` +
      '"Would you like to continue?" deploys nothing (the previous version keeps serving); wrangler deploys the new ' +
      'version BEFORE it publishes custom domains and schedules, so a failure there leaves the new version serving.',
    `Check which version serves: npx wrangler deployments status --env ${PRODUCTION_ENV} ; and ` +
      target.hostnames.map((hostname) => `curl -s https://${hostname}/api/health`).join(' ; '),
  ]
  if (after) {
    const attached = after.domains.map((domain) => domain.hostname)
    const detached = target.hostnames.filter((hostname) => !attached.includes(hostname))
    if (detached.length) {
      advice.push(
        `${detached.join(', ')} is NOT attached to "${target.workerName}" now: rerun deploy (it attaches every configured ` +
          `custom domain) or add it in the dashboard (Workers & Pages -> ${target.workerName} -> Settings -> Domains & Routes).`
      )
    }
    if (after.routes.length) {
      advice.push(`delete the plain routes in the dashboard (${target.zoneName} -> Workers Routes); production uses only custom domains.`)
    }
    const schedules = new Set(after.schedules)
    if (schedules.size !== target.crons.length || target.crons.some((cron) => !schedules.has(cron))) {
      advice.push(
        'the cron schedules differ from wrangler.jsonc: rerun deploy (it sets every schedule) or fix them in ' +
          `Workers & Pages -> ${target.workerName} -> Settings -> Trigger Events. This Worker is the only scheduler.`
      )
    }
  }
  advice.push('If the new version is serving and unhealthy: npm run cf:deploy:production -- rollback')
  console.log(`\n[cf] ${advice.join('\n[cf] ')}`)
}

/**
 * Deploys env.production; returns wrangler's exit status and the version id it
 * reported (null when it deployed nothing). Wrangler answers its own prompts
 * (yes) whenever ci-info detects CI, even in a terminal: `CI`, `BUILD_NUMBER`,
 * `RUN_ID` or a CI vendor's variable in the operator's shell would let it
 * replace a DNS record or take another Worker's hostname that appeared after
 * the preview. `CI=false` is ci-info's documented override (it then skips
 * every other check), so the questions reach the operator's terminal.
 */
function wranglerDeploy(label) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petrios-cf-deploy-'))
  const outputPath = path.join(outDir, 'output.json')
  try {
    const ok = runWrangler(
      ['deploy', '--message', `petrios deploy ${label}`],
      { OPEN_NEXT_DEPLOY: 'true', WRANGLER_OUTPUT_FILE_PATH: outputPath, CI: 'false' },
      PRODUCTION_ENV
    )
    const versionId = fs.existsSync(outputPath) ? deployedVersionId(fs.readFileSync(outputPath, 'utf8')) : null
    return { ok, versionId }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

async function deploy(args) {
  expectArgs('deploy', args, [DRY_RUN])
  const dryRun = args.includes(DRY_RUN)
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const target = loadProductionConfig()
  checkShellAppUrl(target.appUrl)
  const source = checkSourceTree()
  checkWorkerSecrets(target.env)

  let cf
  let before
  let preview
  try {
    cf = await connectCloudflare(target)
    before = await readWorkerState(cf)
    preview = customDomainPreviewProblems(await previewCustomDomains(cf, target.hostnames), before.accountDomains, target)
  } catch (error) {
    if (error instanceof Refusal) throw error
    refuse(
      `could not read the custom domains, routes and cron schedules of "${target.workerName}" or preview the ` +
        `custom-domain change (${error.message}). Nothing was changed. With an API token instead of wrangler login, ` +
        `it needs ${API_TOKEN_PERMISSIONS}.`
    )
  }
  const blockers = [...preview.problems]
  if (before.routes.length) {
    blockers.push(
      `plain routes point at "${target.workerName}" (${before.routes.map((route) => route.pattern).join(', ')}): ` +
        `production uses only custom domains, and wrangler never removes routes. Delete them in the dashboard ` +
        `(${target.zoneName} -> Workers Routes) first`
    )
  }
  if (blockers.length) refuse(`nothing was changed:\n  - ${blockers.join('\n  - ')}`)
  log(
    `Cloudflare now: custom domains [${before.domains.map((domain) => domain.hostname).join(', ')}], no plain routes, ` +
      `${before.schedules.length} cron schedule(s)`
  )
  log('custom-domain preview: no hostname would be detached, taken from another Worker or have a DNS record replaced')
  for (const note of preview.notes) log(`note: ${note}`)
  for (const drift of productionStateProblems(before, target)) {
    log(`note: before this deploy, ${drift}; the deploy sets them from wrangler.jsonc`)
  }

  if (!(await runBuild(PRODUCTION_ENV))) refuse('cf:build or its guard failed; nothing was deployed')

  if (dryRun) {
    log(`dry run: wrangler deploy --dry-run --env ${PRODUCTION_ENV} (bundles and lists the bindings; uploads nothing)`)
    if (!runWrangler(['deploy', '--dry-run'], { OPEN_NEXT_DEPLOY: 'true' }, PRODUCTION_ENV)) {
      refuse('wrangler deploy --dry-run failed; nothing was deployed')
    }
    log('DRY RUN complete: nothing was uploaded and nothing on Cloudflare changed (the preview only computed the diff).')
    log('deploy for real with: npm run cf:deploy:production -- deploy')
    return
  }

  log(
    `deploying "${target.workerName}" (wrangler env ${PRODUCTION_ENV}, APP_URL ${target.appUrl.origin}, ` +
      `custom domains ${target.hostnames.join(', ')})`
  )
  log(
    'if wrangler asks "Would you like to continue?" (the Worker was last changed through the API or dashboard), ' +
      'answer yes; answering no deploys nothing, and this script reports it. If it asks to point a custom domain or a ' +
      'DNS record at this Worker, answer NO: the preview found no such conflict, so something changed in between.'
  )
  if (!interactive) {
    log(
      'not an interactive terminal: wrangler will not ask before replacing a DNS record or moving a hostname, so ' +
        'this deploy relies on the custom-domain preview above (no conflict, no removal, no foreign hostname)'
    )
  }
  const deployed = wranglerDeploy(source.label)

  const problems = []
  let after = null
  try {
    after = await readWorkerState(cf)
  } catch (error) {
    problems.push(`could not read the Worker's custom domains, routes and schedules afterwards (${error.message})`)
  }
  if (after) problems.push(...productionStateProblems(after, target))
  if (!deployed.ok) problems.unshift('wrangler deploy failed')
  else if (!deployed.versionId) problems.unshift('wrangler deploy reported no new version (a prompt was declined, or it aborted)')

  if (!problems.length) {
    printDeployChecklist(target, deployed.versionId)
    return
  }
  reportUnconfirmedDeploy(target, { problems, after })
}

// ---------------------------------------------------------------------------
// rollback [<version-id>]
// ---------------------------------------------------------------------------

function manualRollbackSteps({ workerName }) {
  return (
    `Cloudflare dashboard -> Workers & Pages -> ${workerName} -> Deployments: under Version History pick the last ` +
    'good version and choose Rollback. Leave Settings -> Domains & Routes and Trigger Events alone: a rollback needs neither.'
  )
}

/** The Worker and account from wrangler.jsonc, read leniently so rollback works with an imperfect config. */
function rollbackTarget() {
  let env
  try {
    env = readWranglerConfig().env?.[PRODUCTION_ENV]
  } catch {
    env = undefined
  }
  const target = { workerName: env?.name, accountId: env?.account_id, vars: env?.vars ?? {}, hostnames: [], crons: [] }
  if (!target.workerName || !target.accountId) {
    refuse(
      `wrangler.jsonc env.${PRODUCTION_ENV} lacks its name or account_id. Roll back by hand: ` +
        manualRollbackSteps({ workerName: 'petrios' })
    )
  }
  if (Array.isArray(env.routes)) target.hostnames = env.routes.map((route) => route?.pattern).filter(Boolean)
  if (Array.isArray(env.triggers?.crons)) target.crons = env.triggers.crons
  pinAccount(target.accountId)
  return target
}

async function workerDeployments(cf) {
  const deployments = deploymentsNewestFirst(
    await cloudflareApi(cf.headers, 'GET', `/accounts/${cf.accountId}/workers/scripts/${cf.workerName}/deployments`)
  )
  if (!deployments) throw new Error('the deployments response has an unexpected shape')
  return deployments
}

function workerVersion(cf, versionId) {
  return cloudflareApi(cf.headers, 'GET', `/accounts/${cf.accountId}/workers/scripts/${cf.workerName}/versions/${versionId}`)
}

function printRollbackLimits() {
  console.log(`
[cf] What a rollback does NOT undo:
  - Database migrations: the restored code runs against the current schema (migrations only move forward).
    If it needs the old schema, fix forward instead.
  - Cron triggers, custom domains and routes: they are not part of a Worker version, so they are unchanged and the
    restored code serves the next cron runs on the same schedules.
  - Secrets: the request was never forced, so Cloudflare would have refused it if any secret had changed since the
    restored version served; it runs with the current values. While it is deployed, wrangler secret put/bulk (and
    the secrets command) refuse ("the latest version of your Worker isn't currently deployed"). Do NOT use wrangler
    versions secret put/bulk and wrangler versions deploy instead: they copy the newest UPLOADED version, the code
    you just rolled back from, and deploying that copy undoes this rollback. Ship a fixed main first
    (npm run cf:deploy:production -- deploy), then change secrets with npx wrangler secret put <NAME> --env ${PRODUCTION_ENV}.
  - Data and email: rows written and email sent by the bad version stay.
  - The next deploy ships HEAD again: revert or fix the bad commit on main first.`)
}

/**
 * Sends 100% of traffic to the target version with the deployment request
 * `wrangler rollback` sends, never with `?force=true`. Returns
 * `{ refusedForSecrets }` when Cloudflare refused because secrets changed
 * since the version served (nothing changed), `{ error }` for any other
 * failure (the confirmation read then shows what serves), or `{}`.
 */
async function requestRollback(cf, versionId, message) {
  try {
    await cloudflareApi(
      cf.headers,
      'POST',
      `/accounts/${cf.accountId}/workers/scripts/${cf.workerName}/deployments`,
      rollbackDeploymentBody(versionId, message)
    )
    return {}
  } catch (error) {
    const secrets = error instanceof CloudflareApiError ? secretsChangedError(error.errors) : null
    if (secrets) return { refusedForSecrets: secrets }
    return { error }
  }
}

async function rollback(args) {
  const flags = args.filter((arg) => arg.startsWith('-'))
  const positional = args.filter((arg) => !arg.startsWith('-'))
  if (flags.length) {
    refuse(
      `rollback does not accept ${flags.join(' ')}: it only restores a version's code and vars, never removes ` +
        `custom domains, routes or cron schedules, and never redeploys\n${USAGE}`
    )
  }
  if (positional.length > 1) refuse(`rollback takes at most one version id\n${USAGE}`)
  const requested = positional[0]
  if (requested && !WORKER_VERSION_ID.test(requested)) {
    refuse(`${requested} is not a Worker version id (a lowercase UUID; npx wrangler deployments list --env ${PRODUCTION_ENV} lists them)`)
  }
  const target = rollbackTarget()

  let cf
  let plan
  let targetVersion
  let currentVersion
  try {
    cf = { headers: cloudflareAuthHeaders(), accountId: target.accountId, workerName: target.workerName }
    plan = rollbackPlan(await workerDeployments(cf), requested)
    if (!plan.error) {
      ;[targetVersion, currentVersion] = await Promise.all([
        workerVersion(cf, plan.targetVersionId),
        workerVersion(cf, plan.currentVersionId),
      ])
    }
  } catch (error) {
    if (error instanceof Refusal) throw error
    refuse(
      `could not read the deployment history of "${target.workerName}" (${error.message}). Nothing was changed. ` +
        `Roll back by hand instead: ${manualRollbackSteps(target)}`
    )
  }
  const pickAnother =
    `Pick another version (npx wrangler deployments list --env ${PRODUCTION_ENV} lists them) and pass its id: ` +
    'npm run cf:deploy:production -- rollback <version-id>.'
  const problems = rollbackProblems(plan, { targetVersion, currentVersion })
  if (problems.length) refuse(`not rolling back; nothing was changed:\n  - ${problems.join('\n  - ')}\n${pickAnother}`)

  const rotaThen = versionPlainVars(targetVersion)[ROTA_KILL_SWITCH_VAR]
  const rotaNow = target.vars[ROTA_KILL_SWITCH_VAR]
  if (rotaNow !== undefined && rotaThen !== rotaNow) {
    log(`note: version ${plan.targetVersionId} has ${ROTA_KILL_SWITCH_VAR}="${rotaThen}" (wrangler.jsonc: "${rotaNow}"); the rollback restores the version's value`)
  }
  log(
    `rolling back "${target.workerName}" from version ${plan.currentVersionId} to ${plan.targetVersionId} ` +
      `(served until ${plan.targetServedUntil}; same secret names and production vars). Code and vars only: custom ` +
      'domains, routes and cron schedules are not part of a version and stay as they are. The request is never ' +
      'forced, so Cloudflare refuses it if a secret changed since that version served.'
  )
  const message = `petrios rollback to ${plan.targetVersionId} from ${plan.currentVersionId}`
  const request = await requestRollback(cf, plan.targetVersionId, message)
  if (request.refusedForSecrets) {
    refuse(
      `Cloudflare refused the rollback; nothing was changed. Secrets changed since version ${plan.targetVersionId} ` +
        `served (${request.refusedForSecrets.message ?? `code ${request.refusedForSecrets.code}`}), so it would run ` +
        `with the old values, which may be revoked (a rotated SUPABASE_SERVICE_ROLE_KEY breaks every service-role ` +
        `call). ${pickAnother} Choose one deployed after the secret change, or fix forward with ` +
        'npm run cf:deploy:production -- deploy. Only if every old value is still valid and you mean to restore it, ' +
        `run npx wrangler rollback ${plan.targetVersionId} --env ${PRODUCTION_ENV} yourself in an interactive terminal ` +
        'with CI unset: it lists the changed secrets and asks before reverting them.'
    )
  }
  if (request.error) fail(`the rollback request failed (${request.error.message}); checking what is deployed now`)

  let serving = null
  try {
    serving = (await workerDeployments(cf))[0]?.versions ?? null
  } catch (error) {
    fail(`could not read what is deployed now (${error.message}); check npx wrangler deployments status --env ${PRODUCTION_ENV}`)
  }
  const confirmed =
    Array.isArray(serving) &&
    serving.length === 1 &&
    serving[0]?.version_id === plan.targetVersionId &&
    serving[0]?.percentage === 100
  if (confirmed) {
    log(`ROLLED BACK: version ${plan.targetVersionId} serves 100% of traffic (confirmed from the Cloudflare API)`)
  } else {
    const now = Array.isArray(serving)
      ? serving.map((version) => `${version?.version_id} (${version?.percentage}%)`).join(', ')
      : 'unknown'
    fail(
      `the rollback is NOT confirmed (${request.error ? 'the request failed' : 'the request succeeded'}); deployed now: ${now}. ` +
        `Check npx wrangler deployments status --env ${PRODUCTION_ENV}; by hand: ${manualRollbackSteps(target)}`
    )
  }

  try {
    const domains = domainsForService(await accountCustomDomains(cf), target.workerName).map((domain) => domain.hostname)
    const schedules = await workerSchedules(cf)
    log(`custom domains of "${target.workerName}": ${domains.join(', ') || 'none'}; cron schedules: ${schedules.length}`)
    const missing = target.hostnames.filter((hostname) => !domains.includes(hostname))
    if (missing.length) fail(`${missing.join(', ')} is not attached to "${target.workerName}" (a rollback does not change custom domains; investigate)`)
    if (target.crons.length && (schedules.length !== target.crons.length || target.crons.some((cron) => !schedules.includes(cron)))) {
      fail('the cron schedules differ from wrangler.jsonc (a rollback does not change them; investigate)')
    }
  } catch (error) {
    log(`could not read the custom domains and cron schedules (${error.message}); check them in the dashboard`)
  }
  printRollbackLimits()
}

// ---------------------------------------------------------------------------

async function main() {
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case 'check-secrets': {
      expectArgs(command, args.slice(1), [])
      checkSecretsFile(args[0], loadProductionConfig().env)
      log(`next: npm run cf:deploy:production -- secrets ${args[0]}`)
      return
    }
    case 'secrets': {
      expectArgs(command, args.slice(1), [])
      const target = loadProductionConfig()
      const file = checkSecretsFile(args[0], target.env)
      const stored = storedSecretNames(target.env)
      const replaced = file.names.filter((name) => stored.includes(name))
      const added = file.names.filter((name) => !stored.includes(name))
      log(
        `uploading to the LIVE Worker "${target.workerName}" (wrangler secret bulk --env ${PRODUCTION_ENV}): ` +
          `replaces ${replaced.join(', ') || 'nothing'}; adds ${added.join(', ') || 'nothing'}`
      )
      log('wrangler deploys a new version with these values at once (custom domains and crons are unaffected): a wrong value breaks the live site')
      if (!runWrangler(['secret', 'bulk', file.filePath], {}, PRODUCTION_ENV)) {
        refuse(
          "wrangler secret bulk failed. If it says the latest version of your Worker isn't currently deployed, " +
            `production runs a rolled-back version. ${SECRETS_AFTER_ROLLBACK}`
        )
      }
      log(`done. Delete the file now: rm ${file.filePath}`)
      log(`next: ${target.hostnames.map((hostname) => `curl -s https://${hostname}/api/health`).join(' ; ')}`)
      return
    }
    case 'deploy':
      await deploy(args)
      return
    case 'rollback':
      await rollback(args)
      return
    case 'preflight':
    case 'live':
      refuse(`"${command}" is retired: ${RETIRED_PHASES}`)
      return
    default:
      refuse(command ? `unknown command ${command}\n${USAGE}` : USAGE)
  }
}

main().catch((error) => {
  if (error instanceof Refusal) fail(`refusing: ${error.message}`)
  else fail(error instanceof Error ? error.message : String(error))
})
