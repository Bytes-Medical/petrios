// Side-effecting steps shared by the cf:* npm scripts. Values from local env
// files are compared in memory only; output never contains a value.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import {
  EMPTY_NEXT_ENV_MODULE,
  STREAMING_BACKPRESSURE_MARKER,
  WRANGLER_CONFIG,
  isLocalEnvFile,
  leakCandidates,
  namesFoundIn,
  nextEnvKeyNames,
  parseWranglerConfig,
  patchOpenNextStreamingBackpressure,
} from './lib.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const WRANGLER_CONFIG_PATH = path.join(ROOT, WRANGLER_CONFIG)
const OPEN_NEXT_DIR = path.join(ROOT, '.open-next')
export const NEXT_ENV_PATH = path.join(OPEN_NEXT_DIR, 'cloudflare', 'next-env.mjs')
export const SERVER_HANDLER_PATH = path.join(OPEN_NEXT_DIR, 'server-functions', 'default', 'handler.mjs')
const WORKER_DIR = path.join(ROOT, 'cfw')
export const YOGA_WASM_PATH = path.join(WORKER_DIR, 'yoga.wasm')
export const YOGA_META_PATH = path.join(WORKER_DIR, 'yoga-wasm.json')
const WORKER_FONTS_DIR = path.join(WORKER_DIR, 'public', 'fonts')

export function log(message) {
  console.log(`[cf] ${message}`)
}

export function fail(message) {
  console.error(`[cf] ERROR: ${message}`)
  process.exitCode = 1
}

export function readWranglerConfig() {
  return parseWranglerConfig(fs.readFileSync(WRANGLER_CONFIG_PATH, 'utf8'))
}

function packageBin(packageName, binName) {
  const manifestPath = path.join(ROOT, 'node_modules', packageName, 'package.json')
  const { bin } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const relative = typeof bin === 'string' ? bin : bin[binName]
  return path.join(path.dirname(manifestPath), relative)
}

/**
 * Environment for every wrangler child: never select a named environment from
 * the caller's shell, never fall back to .env files, never send telemetry.
 */
export function wranglerEnv(extra = {}) {
  const env = {
    ...process.env,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    WRANGLER_SEND_METRICS: 'false',
    ...extra,
  }
  delete env.CLOUDFLARE_ENV
  return env
}

/**
 * argv for wrangler against one wrangler.jsonc environment: the top level
 * (staging) by default, or `production`. Always explicit, so CLOUDFLARE_ENV
 * from the shell never selects one.
 */
export function wranglerArgv(args, envName = '') {
  return [packageBin('wrangler', 'wrangler'), ...args, '--config', WRANGLER_CONFIG_PATH, `--env=${envName}`]
}

export function runWrangler(args, extraEnv = {}, envName = '') {
  const result = spawnSync(process.execPath, wranglerArgv(args, envName), {
    cwd: ROOT,
    stdio: 'inherit',
    env: wranglerEnv(extraEnv),
  })
  return result.status === 0
}

/**
 * Runs wrangler with stdout captured (stderr and stdin stay attached), for
 * read-only commands whose output the scripts parse. Callers never print it.
 */
export function captureWrangler(args, envName = '') {
  const result = spawnSync(process.execPath, wranglerArgv(args, envName), {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'inherit'],
    env: wranglerEnv(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return { ok: result.status === 0, stdout: result.stdout ?? '' }
}

function runOpenNextBuild() {
  const result = spawnSync(
    process.execPath,
    [packageBin('@opennextjs/cloudflare', 'opennextjs-cloudflare'), 'build', '--config', WRANGLER_CONFIG_PATH],
    { cwd: ROOT, stdio: 'inherit', env: wranglerEnv({ NEXT_TELEMETRY_DISABLED: '1' }) }
  )
  return result.status === 0
}

function yogaBase64Source() {
  const requireFromRoot = createRequire(path.join(ROOT, 'package.json'))
  const layoutEntry = requireFromRoot.resolve('@react-pdf/layout')
  const yogaEntry = createRequire(layoutEntry).resolve('yoga-layout')
  return path.join(path.dirname(yogaEntry), '..', 'binaries', 'yoga-wasm-base64-esm.js')
}

/**
 * Extracts the wasm that the installed yoga-layout embeds as base64, so the
 * Worker can ship it precompiled (cfw/yoga-redirect.ts), and copies the PDF/OG
 * fonts to where wrangler uploads them as /bundle/public/fonts modules.
 */
export function prepareWorkerModules() {
  const sourcePath = yogaBase64Source()
  const source = fs.readFileSync(sourcePath, 'utf8')
  const embedded = [...source.matchAll(/"data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/g)]
  if (embedded.length !== 1 || !source.includes('WebAssembly.instantiate(')) {
    throw new Error(
      `${path.relative(ROOT, sourcePath)} no longer embeds exactly one base64 wasm instantiated from bytes; ` +
        'the Workers yoga redirect (cfw/yoga-redirect.ts) must be revisited'
    )
  }
  const wasm = Buffer.from(embedded[0][1], 'base64')
  if (!WebAssembly.validate(wasm)) throw new Error('decoded yoga-layout wasm is not valid WebAssembly')
  fs.writeFileSync(YOGA_WASM_PATH, wasm)
  const meta = { byteLength: wasm.byteLength, sha256: createHash('sha256').update(wasm).digest('hex') }
  fs.writeFileSync(YOGA_META_PATH, `${JSON.stringify(meta, null, 2)}\n`)
  log(`yoga wasm: ${meta.byteLength} bytes, sha256 ${meta.sha256}`)

  fs.rmSync(path.join(WORKER_DIR, 'public'), { recursive: true, force: true })
  fs.mkdirSync(WORKER_FONTS_DIR, { recursive: true })
  const fonts = fs.readdirSync(path.join(ROOT, 'public', 'fonts')).filter((name) => name.endsWith('.ttf'))
  for (const name of fonts) {
    fs.copyFileSync(path.join(ROOT, 'public', 'fonts', name), path.join(WORKER_FONTS_DIR, name))
  }
  log(`fonts: ${fonts.length} copied to cfw/public/fonts`)
}

export function scrubNextEnv() {
  if (!fs.existsSync(path.dirname(NEXT_ENV_PATH))) {
    throw new Error('.open-next/cloudflare is missing; the OpenNext build did not run')
  }
  fs.writeFileSync(NEXT_ENV_PATH, EMPTY_NEXT_ENV_MODULE)
  log('next-env.mjs scrubbed (no local .env values reach the Worker)')
}

/**
 * Restores streaming backpressure in OpenNext's bundled response writer
 * (lib.mjs patchOpenNextStreamingBackpressure). Throws if the expected code is
 * not found exactly once.
 */
export function patchStreamingBackpressure() {
  if (!fs.existsSync(SERVER_HANDLER_PATH)) {
    throw new Error('.open-next/server-functions/default/handler.mjs is missing; the OpenNext build did not run')
  }
  const source = fs.readFileSync(SERVER_HANDLER_PATH, 'utf8')
  const patched = patchOpenNextStreamingBackpressure(source)
  if (patched !== source) fs.writeFileSync(SERVER_HANDLER_PATH, patched)
  log('OpenNext response writer patched for streaming backpressure')
}

/** True when the built server handler carries the streaming backpressure patch. */
export function serverHandlerIsPatched() {
  return fs.existsSync(SERVER_HANDLER_PATH) && fs.readFileSync(SERVER_HANDLER_PATH, 'utf8').includes(STREAMING_BACKPRESSURE_MARKER)
}

export async function nextEnvLeaks() {
  if (!fs.existsSync(NEXT_ENV_PATH)) throw new Error('.open-next/cloudflare/next-env.mjs is missing; run npm run cf:build')
  const nextEnvModule = await import(`${pathToFileURL(NEXT_ENV_PATH).href}?t=${Date.now()}`)
  return nextEnvKeyNames(nextEnvModule)
}

function localEnvEntries() {
  const entries = []
  for (const fileName of fs.readdirSync(ROOT).filter(isLocalEnvFile).sort()) {
    const filePath = path.join(ROOT, fileName)
    if (!fs.statSync(filePath).isFile()) continue
    for (const [name, value] of Object.entries(parseEnv(fs.readFileSync(filePath, 'utf8')))) {
      entries.push({ name, value })
    }
  }
  return entries
}

function* filesUnder(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* filesUnder(entryPath)
    else if (entry.isFile()) yield entryPath
  }
}

function* fileContents(dirs) {
  for (const dir of dirs) for (const file of filesUnder(dir)) yield fs.readFileSync(file)
}

/**
 * Fails when OpenNext's .env snapshot has any key, or when any local .env*
 * value (>= 12 chars, not NEXT_PUBLIC_*, not in .env.example) appears in the
 * exact files `wrangler deploy` would upload: the dry-run bundle and the
 * static assets directory. Prints variable names only.
 */
export async function runGuard(envName = '') {
  let passed = true
  const snapshotKeys = await nextEnvLeaks()
  if (snapshotKeys.length) {
    fail(`next-env.mjs would copy local .env variables into the Worker: ${snapshotKeys.join(', ')}`)
    passed = false
  }

  const examplePath = path.join(ROOT, '.env.example')
  const publicText = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : ''
  const { secret, browserPublic } = leakCandidates(localEnvEntries(), publicText)

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petrios-cf-guard-'))
  try {
    const target = envName ? ` --env ${envName}` : ''
    log(`dry-run bundle (wrangler deploy --dry-run${target}; does not contact Cloudflare)`)
    if (!runWrangler(['deploy', '--dry-run', '--outdir', outDir], { OPEN_NEXT_DEPLOY: 'true' }, envName)) {
      fail('wrangler deploy --dry-run failed')
      return false
    }
    const marker = [{ name: STREAMING_BACKPRESSURE_MARKER, needles: [STREAMING_BACKPRESSURE_MARKER] }]
    if (!namesFoundIn(marker, fileContents([outDir])).length) {
      fail('the Worker upload lacks the OpenNext streaming backpressure patch; run npm run cf:build')
      passed = false
    }
    const assetsDir = path.resolve(ROOT, readWranglerConfig().assets.directory)
    const scanned = [outDir, assetsDir]
    const leaked = namesFoundIn(secret, fileContents(scanned))
    const inlinedPublic = namesFoundIn(browserPublic, fileContents(scanned))
    if (inlinedPublic.length) {
      log(`warning: local NEXT_PUBLIC_* values were inlined at build time: ${inlinedPublic.join(', ')}`)
    }
    if (leaked.length) {
      fail(`values of these local .env variables are in the Worker upload: ${leaked.join(', ')}`)
      passed = false
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
  if (passed) {
    log(`guard passed (${secret.length} local secret value(s) checked; none in the upload; backpressure patch present)`)
  }
  return passed
}

/**
 * cf:build — OpenNext build, Worker modules, .env scrub, backpressure patch,
 * then the guard (its dry run uses `envName`; the bundle is the same for all).
 */
export async function runBuild(envName = '') {
  if (!runOpenNextBuild()) {
    fail('opennextjs-cloudflare build failed')
    return false
  }
  prepareWorkerModules()
  scrubNextEnv()
  patchStreamingBackpressure()
  return runGuard(envName)
}
