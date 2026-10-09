// npm run cf:preview [-- extra `wrangler dev` flags, e.g. --test-scheduled]
// Serves the already-built Worker locally with variables from .dev.vars only.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  NEXT_ENV_PATH,
  ROOT,
  YOGA_META_PATH,
  YOGA_WASM_PATH,
  fail,
  nextEnvLeaks,
  serverHandlerIsPatched,
  wranglerArgv,
  wranglerEnv,
} from './tasks.mjs'

const FORBIDDEN_FLAGS = ['--env', '-e', '--env-file', '--config', '-c']

async function main() {
  const extraArgs = process.argv.slice(2)
  const forbidden = extraArgs.find((arg) => FORBIDDEN_FLAGS.includes(arg.split('=')[0]))
  if (forbidden) return fail(`${forbidden} is not allowed: cf:preview always uses wrangler.jsonc's top level and .dev.vars`)

  if (!fs.existsSync(path.join(ROOT, '.dev.vars'))) {
    return fail('.dev.vars is missing. Copy .dev.vars.example and use placeholders or a NON-production project')
  }
  for (const required of [path.join(ROOT, '.open-next', 'worker.js'), NEXT_ENV_PATH, YOGA_WASM_PATH, YOGA_META_PATH]) {
    if (!fs.existsSync(required)) return fail(`${path.relative(ROOT, required)} is missing; run npm run cf:build first`)
  }
  const snapshotKeys = await nextEnvLeaks()
  if (snapshotKeys.length) {
    return fail(`next-env.mjs is not scrubbed (${snapshotKeys.join(', ')}); run npm run cf:build`)
  }
  if (!serverHandlerIsPatched()) {
    return fail('the server handler lacks the streaming backpressure patch; run npm run cf:build')
  }

  const child = spawn(process.execPath, wranglerArgv(['dev', ...extraArgs]), {
    cwd: ROOT,
    stdio: 'inherit',
    env: wranglerEnv(),
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0)
  })
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
