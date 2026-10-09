// APP_URL=https://petrios-staging.<account-subdomain>.workers.dev npm run cf:deploy:staging
// Deploys the top-level (staging) Worker only. There is deliberately no
// production deploy script: see docs/cloudflare-workers.md, "Cutover".
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, fail, log, readWranglerConfig, runBuild, runWrangler } from './tasks.mjs'
import { secretsFileNames, secretsFileProblems, stagingConfigProblems, validateStagingAppUrl } from './lib.mjs'

/**
 * Checks a first-deploy secrets file by variable NAME only (values are never
 * printed): wrangler would otherwise let it silently replace validated vars.
 */
function checkSecretsFile(argument, config) {
  let filePath
  let text
  try {
    filePath = fs.realpathSync(path.resolve(argument))
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    return { error: `cannot read the secrets file ${argument}` }
  }
  const parsed = secretsFileNames(text)
  if (parsed.error) return { error: parsed.error }
  const problems = secretsFileProblems(parsed.names, config, { filePath, root: fs.realpathSync(ROOT) })
  if (problems.length) return { error: problems.join('; ') }
  return { filePath, names: parsed.names }
}

async function main() {
  const extraArgs = process.argv.slice(2)
  const allowed = extraArgs.length === 0 || (extraArgs.length === 2 && extraArgs[0] === '--secrets-file')
  if (!allowed) return fail('the only extra argument accepted is --secrets-file <path> (first deploy of a new Worker)')

  const config = readWranglerConfig()
  const problems = stagingConfigProblems(config)
  if (problems.length) return fail(`refusing to deploy: ${problems.join('; ')}`)

  const appUrl = validateStagingAppUrl(process.env.APP_URL, config.name)
  if (appUrl.error) return fail(`refusing to deploy: ${appUrl.error}`)

  const deployArgs = ['deploy', '--var', `APP_URL:${appUrl.origin}`]
  if (extraArgs.length) {
    const secretsFile = checkSecretsFile(extraArgs[1], config)
    if (secretsFile.error) return fail(`refusing to deploy: ${secretsFile.error}`)
    log(`secrets file supplies: ${secretsFile.names.join(', ')}`)
    deployArgs.push('--secrets-file', secretsFile.filePath)
  }

  if (!(await runBuild())) return fail('refusing to deploy: cf:build or its guard failed')

  log(`deploying ${config.name} with APP_URL=${appUrl.origin}`)
  if (!runWrangler(deployArgs, { OPEN_NEXT_DEPLOY: 'true' })) {
    fail('wrangler deploy failed')
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
