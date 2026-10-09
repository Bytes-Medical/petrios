// Production (petrios.uk) on Cloudflare Workers. docs/cloudflare-workers.md, "Cutover".
//
//   npm run cf:deploy:production -- check-secrets <file>   validate a filled secrets file (local only)
//   npm run cf:deploy:production -- secrets <file>         check-secrets, then wrangler secret bulk
//   npm run cf:deploy:production -- preflight              workers.dev only: no routes, no crons, email off
//   npm run cf:deploy:production -- live --render-crons-disabled
//   npm run cf:deploy:production -- rollback [--skip-redeploy]
//
// Both phases deploy ONE Worker (env.production and env.production_preflight
// share its name, account and secrets). Wrangler never removes routes a
// previous deploy attached, so preflight refuses while routes exist and
// rollback deletes them through the Cloudflare API with the operator's own
// wrangler credentials. Wrangler can exit 0 without deploying (a declined
// prompt), so every deploy is confirmed afterwards from the version it
// reported and the routes and schedules the API shows. Secret values and
// credentials are never printed.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT, captureWrangler, fail, log, readWranglerConfig, runBuild, runWrangler } from './tasks.mjs'
import {
  CRON_RUN_MAX_MINUTES,
  PREFLIGHT_ENV,
  PRODUCTION_ENV,
  cronScheduleExpressions,
  deployedVersionId,
  dirtyPaths,
  domainsForService,
  parseProductionSecretsFile,
  parseSecretList,
  productionConfigProblems,
  productionSecretNameProblems,
  productionSecretsFileProblems,
  productionStateProblems,
  renderResumeTime,
  routesForScript,
  scheduleExpressions,
  validateProductionAppUrl,
} from './lib.mjs'

const LIVE_ATTESTATION = '--render-crons-disabled'
const SKIP_REDEPLOY = '--skip-redeploy'
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
const SECRETS_EXAMPLE = '~/petrios-production-secrets.json'
const CLEAN_CHECKOUT =
  'git fetch origin && git worktree add --detach ../petrios-deploy origin/main && cd ../petrios-deploy && npm ci'
const USAGE = [
  'usage: npm run cf:deploy:production -- <command>',
  '  check-secrets <file>                validate a filled secrets file (names only; contacts nothing)',
  '  secrets <file>                      check-secrets, then upload it with wrangler secret bulk',
  '  preflight                           deploy to workers.dev only: no routes, no crons, email off',
  `  live ${LIVE_ATTESTATION}       serve petrios.uk and run the crons (Render's jobs disabled first)`,
  `  rollback [${SKIP_REDEPLOY}]          remove the route and cron schedules, then redeploy preflight`,
].join('\n')

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
  const live = config.env[PRODUCTION_ENV]
  pinAccount(live.account_id)
  return {
    config,
    workerName: live.name,
    accountId: live.account_id,
    zoneName: live.routes[0].zone_name,
    appUrl: validateProductionAppUrl(live.vars.APP_URL),
    routePatterns: live.routes.map((route) => route.pattern),
    crons: live.triggers.crons,
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

/** Read-only `wrangler secret list`: names only (the API never returns values). */
function checkWorkerSecrets(env, envName) {
  const listed = captureWrangler(['secret', 'list', '--format', 'json'], envName)
  if (!listed.ok) {
    refuse(
      `could not list the secrets of the "${env.name}" Worker (read-only wrangler secret list --env ${envName}). ` +
        `If the Worker does not exist yet, create it with its secrets first: npm run cf:deploy:production -- secrets ${SECRETS_EXAMPLE}. ` +
        'Otherwise run npx wrangler login.'
    )
  }
  const parsed = parseSecretList(listed.stdout)
  if (parsed.error) refuse(parsed.error)
  const problems = productionSecretNameProblems(parsed.names, env, envName)
  if (problems.length) refuse(problems.join('\n  '))
  const optional = parsed.names.filter((name) => !env.secrets.required.includes(name))
  log(`Worker secrets (names only): all ${env.secrets.required.length} required present; optional: ${optional.join(', ') || 'none'}`)
}

function checkSecretsFile(argument, config) {
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
  const env = config.env[PREFLIGHT_ENV]
  const { problems, unknown } = productionSecretsFileProblems(parsed.entries, env, {
    filePath,
    root: fs.realpathSync(ROOT),
  })
  if (unknown.length) log(`warning: names Petrios does not read (check the spelling): ${unknown.join(', ')}`)
  if (problems.length) refuse(`the secrets file is not ready:\n  - ${problems.join('\n  - ')}`)
  if (process.platform !== 'win32' && fs.statSync(filePath).mode & 0o077) {
    log(`warning: ${filePath} is readable by other users; run chmod 600 on it`)
  }
  log(`secrets file OK: ${parsed.entries.map((entry) => entry.name).join(', ')}`)
  return filePath
}

// ---------------------------------------------------------------------------
// Cloudflare API (routes, custom domains, schedules), with the operator's wrangler login
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
    const detail = payload?.errors?.map((error) => `${error.code}: ${error.message}`).join('; ') || `HTTP ${response.status}`
    throw new Error(`${method} ${pathname.split('?')[0]} failed (${detail})`)
  }
  return payload.result
}

/** Credentials plus the zone of the live route, in the pinned account. */
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

async function workerRoutes(cf) {
  return routesForScript(await cloudflareApi(cf.headers, 'GET', `/zones/${cf.zoneId}/workers/routes`), cf.workerName)
}

/** The Worker's routes in the zone, custom domains and cron schedules, as the API reports them now. */
async function readWorkerState(cf) {
  const routes = await workerRoutes(cf)
  const service = new URLSearchParams({ service: cf.workerName })
  const domains = domainsForService(
    await cloudflareApi(cf.headers, 'GET', `/accounts/${cf.accountId}/workers/domains?${service}`),
    cf.workerName
  )
  const schedules = scheduleExpressions(
    await cloudflareApi(cf.headers, 'GET', `/accounts/${cf.accountId}/workers/scripts/${cf.workerName}/schedules`)
  )
  return { routes, domains, schedules }
}

function manualRollbackSteps({ zoneName, workerName }) {
  return (
    `Cloudflare dashboard -> ${zoneName} -> Workers Routes: delete every route whose Worker is "${workerName}" ` +
    `(or Workers & Pages -> ${workerName} -> Settings -> Domains & Routes). Do not touch DNS records. ` +
    `Then Workers & Pages -> ${workerName} -> Settings -> Trigger Events: delete every Cron Trigger.`
  )
}

function customDomainSteps({ workerName }, domains) {
  return (
    `custom domains serve "${workerName}": ${domains.map((domain) => domain.hostname).join(', ')}. ` +
    `Remove them by hand (Workers & Pages -> ${workerName} -> Settings -> Domains & Routes). Removing one deletes ` +
    'the DNS record Cloudflare made for it: afterwards check that each hostname has its proxied record pointing at Render.'
  )
}

/**
 * Takes the Worker out of production: deletes its routes (traffic returns to
 * Render through the unchanged proxied DNS record) and clears its cron
 * schedules, then confirms both. Custom domains are reported, never deleted
 * (that would delete DNS records). Never throws.
 */
async function detachWorker(cf) {
  const outcome = { routesCleared: false, cronsCleared: false, domains: [], clearedAt: new Date(), complete: false }
  log(`deleting the routes of "${cf.workerName}" in ${cf.zoneName} (DNS records stay as they are)`)
  try {
    for (const route of await workerRoutes(cf)) {
      await cloudflareApi(cf.headers, 'DELETE', `/zones/${cf.zoneId}/workers/routes/${route.id}`)
      log(`deleted route ${route.pattern}`)
    }
    outcome.routesCleared = true
  } catch (error) {
    fail(`could not delete the routes (${error.message})`)
  }

  log(`clearing the cron schedules of "${cf.workerName}"`)
  try {
    await cloudflareApi(cf.headers, 'PUT', `/accounts/${cf.accountId}/workers/scripts/${cf.workerName}/schedules`, [])
    outcome.cronsCleared = true
  } catch (error) {
    fail(`could not clear the cron schedules (${error.message})`)
  }
  outcome.clearedAt = new Date()

  try {
    const state = await readWorkerState(cf)
    outcome.domains = state.domains
    outcome.routesCleared &&= state.routes.length === 0
    outcome.cronsCleared &&= state.schedules.length === 0
    for (const problem of productionStateProblems('preflight', { ...state, domains: [] })) fail(problem)
  } catch (error) {
    fail(`could not confirm the result (${error.message})`)
    outcome.routesCleared = false
    outcome.cronsCleared = false
  }
  outcome.complete = outcome.routesCleared && outcome.cronsCleared && !outcome.domains.length
  if (outcome.routesCleared) log(`no route points at "${cf.workerName}": ${cf.zoneName} traffic is on Render`)
  if (outcome.cronsCleared) log(`"${cf.workerName}" has no cron schedules`)
  if (outcome.domains.length) fail(customDomainSteps(cf, outcome.domains))
  if (!outcome.routesCleared || !outcome.cronsCleared) fail(`finish by hand now: ${manualRollbackSteps(cf)}`)
  return outcome
}

/** When Render's suspended jobs may resume after the Worker's schedules were cleared. */
function resumeRender(outcome) {
  return (
    `resume Render's scheduled jobs (the ones suspended for the cutover) at or after ${renderResumeTime(outcome.clearedAt)}: ` +
    `a Worker cron run that started before the schedules were cleared can keep running for up to ${CRON_RUN_MAX_MINUTES} minutes, ` +
    'and two runs of a job at once can send email twice (ops-weekly has no dedupe).'
  )
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function printPreflightChecklist({ workerName }, versionId) {
  console.log(`
[cf] PREFLIGHT deployed (version ${versionId}). "${workerName}" has no routes, custom domains or cron schedules;
     Render still serves petrios.uk.
  Its URL is the workers.dev line wrangler printed above (https://${workerName}.<account-subdomain>.workers.dev).
  1. Health:  curl -s https://${workerName}.<account-subdomain>.workers.dev/api/health   expect {"status":"ok","db":"ok"}
  2. Smoke:   docs/cloudflare-workers.md, "Cutover" step 3 (email is off; sign-in links lead to petrios.uk on Render)
  3. Logs:    npx wrangler tail --env ${PREFLIGHT_ENV} --format pretty
  4. Next:    disable Render's scheduled jobs ("Cutover" step 4), then:
              npm run cf:deploy:production -- live ${LIVE_ATTESTATION}`)
}

function printLiveChecklist({ appUrl, routePatterns }, versionId) {
  const host = appUrl.host
  const www = host.startsWith('www.') ? null : `www.${host}`
  const wwwCheck = www
    ? `
     ${www} has no route and must be unchanged:
       curl -sI https://${www}/login | grep -iE '^(HTTP|location|rndr-id)'
     expect a 301 with location: https://${host}/login and no rndr-id.`
    : ''
  console.log(`
[cf] LIVE (version ${versionId ?? 'not reported'}): ${routePatterns.join(', ')} routes to the Worker and its cron schedules are set; DNS is unchanged.
  1. Served by the Worker (repeat until it holds):
       curl -sI https://${host}/login | grep -iE '^(rndr-id|x-render-origin-server|cf-ray):'
     Only cf-ray: the Worker answered. rndr-id or x-render-origin-server: Render answered (retry after 30 s).${wwwCheck}
  2. Health:   curl -s ${appUrl.origin}/api/health   expect {"status":"ok","db":"ok"}
  3. Logs:     npx wrangler tail --env ${PRODUCTION_ENV} --format pretty
     Crons appear as '"<expression>" @ <time> - Ok' with a '[cron] ... HTTP 200' log line. These are the first
     cron runs on the Workers runtime (staging and preflight never run any): watch the first recall-awards,
     session-reminders (:00) and post-session-reports (:15), then the next morning's daily jobs.
     Stray schedulers: npx wrangler tail --env ${PRODUCTION_ENV} --format pretty | grep -E '^(GET|POST|HEAD) .*/api/cron/'
     Any match is an external caller still running (it gets 401): find and disable it.
  4. Rollback (seconds, no rebuild needed for traffic):  npm run cf:deploy:production -- rollback
  5. Keep the Render service running WITHOUT its scheduled jobs for at least a week as the warm fallback.`)
}

/** Deploys one phase; returns wrangler's exit status and the version id it reported (null when it deployed nothing). */
function wranglerDeploy(phase, envName, label) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petrios-cf-deploy-'))
  const outputPath = path.join(outDir, 'output.json')
  try {
    const ok = runWrangler(
      ['deploy', '--message', `petrios ${phase} ${label}`],
      { OPEN_NEXT_DEPLOY: 'true', WRANGLER_OUTPUT_FILE_PATH: outputPath },
      envName
    )
    const versionId = fs.existsSync(outputPath) ? deployedVersionId(fs.readFileSync(outputPath, 'utf8')) : null
    return { ok, versionId }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

/** A live deploy that is not confirmed. Always returns false. */
async function handleFailedLive(cf, target, { before, after, problems }) {
  fail(`the live deploy is NOT confirmed:\n  - ${problems.join('\n  - ')}`)
  if (before.routes.length) {
    // A redeploy of a Worker that was already live.
    if (after && after.routes.length === 0) {
      console.log(`
[cf] No route points at the Worker now: Render serves ${target.appUrl.host}, and Render's scheduled jobs are suspended.
     Run npm run cf:deploy:production -- rollback now (it clears the Worker's schedules), then follow what it prints.`)
    } else {
      console.log(`
[cf] The Worker was already live. If wrangler rejected the upload or a prompt was declined, the previous
     version still serves ${target.appUrl.host} and runs the jobs. Check curl -s ${target.appUrl.origin}/api/health and
     npx wrangler deployments status --env ${PRODUCTION_ENV}. Run rollback only if the site is unhealthy;
     otherwise fix the problem and rerun live.`)
    }
    return false
  }

  // First go-live: return to the pre-cutover state at once, so Render keeps
  // serving and exactly one decision (retry live, or resume Render) remains.
  log('the first go-live is not confirmed: removing whatever it attached (route, cron schedules) so Render keeps serving')
  const outcome = await detachWorker(cf)
  const workerCronsMayHaveRun = !after || after.schedules.length > 0 || before.schedules.length > 0
  if (!outcome.complete) {
    console.log(`
[cf] NOT LIVE, AND NOT FULLY DETACHED: finish the manual steps above. Render's scheduled jobs are suspended;
     only after the Worker has no route and no cron schedule, ${resumeRender(outcome)}`)
    return false
  }
  console.log(`
[cf] NOT LIVE: Render serves ${target.appUrl.host}; the Worker has no route, custom domain or cron schedule.
     Render's scheduled jobs are still suspended, so nothing runs the jobs now. Either fix the problem and rerun
       npm run cf:deploy:production -- live ${LIVE_ATTESTATION}
     or ${
       workerCronsMayHaveRun
         ? resumeRender(outcome)
         : "resume Render's scheduled jobs now (the Worker had no cron schedule during this attempt)."
     }`)
  return false
}

async function deployPhase(phase, args) {
  const attested = args.includes(LIVE_ATTESTATION)
  expectArgs(phase, args, phase === 'live' ? [LIVE_ATTESTATION] : [])
  if (phase === 'live' && !attested) {
    refuse(
      `going live starts the cron triggers against the production database, and only one scheduler may run them. ` +
        `Disable Render's scheduled jobs first (docs/cloudflare-workers.md, "Cutover" step 4), then attest it: ` +
        `npm run cf:deploy:production -- live ${LIVE_ATTESTATION}`
    )
  }
  const progress = { before: null, deployStarted: false }
  try {
    return await deployAndConfirm(phase, progress)
  } catch (error) {
    if (progress.deployStarted) throw error
    const message = error instanceof Error ? error.message : String(error)
    // Nothing was deployed: say what that means for traffic and the schedulers.
    if (phase === 'preflight') refuse(`${message}\nNothing was deployed; production is unaffected.`)
    if (!progress.before) {
      refuse(
        `${message}\nNothing was deployed. If the Worker is already live, it keeps serving and running the jobs. ` +
          "If this is the first go-live, Render's scheduled jobs are suspended and nothing runs the jobs: " +
          "fix this and rerun live soon, or resume Render's scheduled jobs (the Worker has no cron schedule)."
      )
    }
    refuse(
      progress.before.routes.length
        ? `${message}\nNothing was deployed; the live Worker keeps serving and running the jobs.`
        : `${message}\nNothing was deployed: Render serves petrios.uk and its scheduled jobs are suspended, so nothing ` +
            "runs the jobs. Fix this and rerun live soon, or resume Render's scheduled jobs now (the Worker has no cron schedule)."
    )
  }
}

async function deployAndConfirm(phase, progress) {
  const target = loadProductionConfig()
  const envName = phase === 'live' ? PRODUCTION_ENV : PREFLIGHT_ENV
  const env = target.config.env[envName]
  checkShellAppUrl(target.appUrl)
  const source = checkSourceTree()
  checkWorkerSecrets(env, envName)

  let cf
  let before
  try {
    cf = await connectCloudflare(target)
    before = await readWorkerState(cf)
  } catch (error) {
    if (error instanceof Refusal) throw error
    refuse(
      `could not read the routes, custom domains and cron schedules of "${target.workerName}" (${error.message}). ` +
        'With an API token instead of wrangler login, it needs Zone Read, Workers Routes Edit and Workers Scripts Edit.'
    )
  }
  if (before.domains.length) refuse(customDomainSteps(target, before.domains))
  if (phase === 'preflight' && before.routes.length) {
    refuse(
      `"${target.workerName}" still has routes (${before.routes.map((route) => route.pattern).join(', ')}): it is serving production. ` +
        'Wrangler would leave them in place, so preflight would serve real users with email and crons off. ' +
        'To leave production, run: npm run cf:deploy:production -- rollback'
    )
  }
  progress.before = before
  if (phase === 'live') {
    log(`Render's scheduled jobs attested disabled (${LIVE_ATTESTATION})`)
    log(before.routes.length ? 'the Worker is already live: this is a redeploy' : 'the Worker has no routes: this is the first go-live')
  } else {
    log(`"${target.workerName}" has no routes or custom domains`)
    if (before.schedules.length) log(`note: it still has cron schedules (${before.schedules.join(', ')}); preflight clears them`)
  }

  if (!(await runBuild(envName))) refuse('cf:build or its guard failed')

  log(`deploying "${env.name}" (${phase}, wrangler env ${envName}, APP_URL ${target.appUrl.origin})`)
  log(
    'if wrangler asks "Would you like to continue?" (the Worker was last changed through the API or dashboard), ' +
      'answer yes; answering no deploys nothing, and this script reports it'
  )
  progress.deployStarted = true
  const deployed = wranglerDeploy(phase, envName, source.label)

  const problems = []
  let after = null
  try {
    after = await readWorkerState(cf)
  } catch (error) {
    problems.push(`could not read the Worker's routes and schedules afterwards (${error.message})`)
  }
  const stateProblems = after ? productionStateProblems(phase, after, target) : []
  problems.push(...stateProblems)
  if (!deployed.ok) {
    problems.unshift('wrangler deploy failed')
  } else if (!deployed.versionId) {
    // A declined prompt exits 0 with no version. On a first go-live the
    // API state tells the two apart (a declined deploy attaches no route);
    // anywhere else the previous version would still match, so it fails.
    const firstGoLive = phase === 'live' && !before.routes.length
    if (firstGoLive && after && !stateProblems.length) {
      log('warning: wrangler reported no version id, but the route and cron schedules match the live phase')
    } else {
      problems.unshift('wrangler deploy reported no new version (a prompt was declined, or it aborted)')
    }
  }

  if (!problems.length) {
    if (phase === 'live') printLiveChecklist(target, deployed.versionId)
    else printPreflightChecklist(target, deployed.versionId)
    return true
  }
  if (phase === 'live') return handleFailedLive(cf, target, { before, after, problems })
  fail(
    `the preflight deploy is NOT confirmed:\n  - ${problems.join('\n  - ')}\n` +
      '[cf] Production traffic is unaffected (the Worker had no routes). Fix the problem and rerun preflight; ' +
      'if cron schedules remain, run npm run cf:deploy:production -- rollback to clear them.'
  )
  return false
}

/** The Worker, account and zone from wrangler.jsonc, read leniently so rollback works with an imperfect config. */
function rollbackTarget() {
  const live = readWranglerConfig().env?.[PRODUCTION_ENV]
  const target = { workerName: live?.name, accountId: live?.account_id, zoneName: live?.routes?.[0]?.zone_name }
  if (!target.workerName || !target.zoneName || !target.accountId) {
    refuse(
      `wrangler.jsonc env.${PRODUCTION_ENV} lacks its name, account_id or routes. Roll back by hand: ` +
        `${manualRollbackSteps({ zoneName: 'petrios.uk', workerName: 'petrios' })} ` +
        `Re-enable Render's scheduled jobs no sooner than ${CRON_RUN_MAX_MINUTES} minutes after the last Cron Trigger is deleted.`
    )
  }
  pinAccount(target.accountId)
  return target
}

async function rollback(args) {
  expectArgs('rollback', args, [SKIP_REDEPLOY])
  const target = rollbackTarget()
  let cf
  try {
    cf = await connectCloudflare(target)
  } catch (error) {
    refuse(
      `${error.message}\nRoll back by hand instead: ${manualRollbackSteps(target)} ` +
        `Re-enable Render's scheduled jobs no sooner than ${CRON_RUN_MAX_MINUTES} minutes after the last Cron Trigger is deleted.`
    )
  }
  log('rollback 1-2/3: removing the route and the cron schedules')
  const outcome = await detachWorker(cf)
  if (!outcome.complete) {
    console.log(`
[cf] ROLLBACK INCOMPLETE: finish the manual steps above. Only after the Worker has no route and no cron schedule,
     ${resumeRender(outcome)}`)
    return
  }
  console.log(`
[cf] ROLLED BACK: Render serves ${target.zoneName} again and the Worker has no route, custom domain or cron schedule.
     NEXT: ${resumeRender(outcome)}
     The Worker is unreachable (no routes, no workers.dev) until preflight is redeployed.`)

  if (args.includes(SKIP_REDEPLOY)) {
    log('skipped the preflight redeploy; run npm run cf:deploy:production -- preflight when convenient')
    return
  }
  log('rollback 3/3: redeploying the preflight shape (rebuilds; traffic is already on Render)')
  try {
    if (!(await deployPhase('preflight', []))) {
      log('the preflight redeploy is not confirmed; production is unaffected. Fix it and run the preflight command again.')
    }
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    fail(`preflight redeploy refused: ${error.message}`)
    log('production is unaffected (traffic is on Render). Fix the above, then run: npm run cf:deploy:production -- preflight')
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case 'check-secrets': {
      expectArgs(command, args.slice(1), [])
      checkSecretsFile(args[0], loadProductionConfig().config)
      log(`next: npm run cf:deploy:production -- secrets ${args[0]}`)
      return
    }
    case 'secrets': {
      expectArgs(command, args.slice(1), [])
      const filePath = checkSecretsFile(args[0], loadProductionConfig().config)
      log(`uploading the secrets to the production Worker (wrangler secret bulk --env ${PREFLIGHT_ENV})`)
      log('if the Worker does not exist yet, wrangler offers to create an empty one: answer yes (no routes, no traffic)')
      if (!runWrangler(['secret', 'bulk', filePath], {}, PREFLIGHT_ENV)) {
        refuse('wrangler secret bulk failed; nothing else was changed')
      }
      log(`done. Delete the file now: rm ${filePath}`)
      log('next: npm run cf:deploy:production -- preflight')
      return
    }
    case 'preflight':
    case 'live':
      await deployPhase(command, args)
      return
    case 'rollback':
      await rollback(args)
      return
    default:
      refuse(command ? `unknown command ${command}\n${USAGE}` : USAGE)
  }
}

main().catch((error) => {
  if (error instanceof Refusal) fail(`refusing: ${error.message}`)
  else fail(error instanceof Error ? error.message : String(error))
})
