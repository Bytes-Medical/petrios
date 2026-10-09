import { spawn } from 'node:child_process'
import { configureKeys } from './keys.mjs'
configureKeys()
const envValue = (name, alias) => process.env[name] || process.env[alias]
for (const [name, alias] of [['APP_URL','NEXT_PUBLIC_APP_URL'],['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL']]) {
  const url = new URL(envValue(name, alias) || '')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['https:','http:'].includes(url.protocol)) throw new Error(`${name} must be an HTTP(S) origin`)
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error(`${name} must use HTTPS outside localhost`)
}
if (!envValue('SUPABASE_ANON_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY') || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase API keys are required')
if (!/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(envValue('JITSI_DOMAIN','NEXT_PUBLIC_JITSI_DOMAIN') || 'meet.jit.si')) throw new Error('Invalid Jitsi domain')
if (process.env.SELF_HOSTED_SETUP === 'true' && (process.env.SETUP_TOKEN || '').length < 32) throw new Error('SETUP_TOKEN must contain at least 32 characters')
let active
const run = (file) => new Promise((resolve, reject) => {
  active = spawn(process.execPath, [file], { stdio: 'inherit', env: process.env })
  active.once('error', reject)
  active.once('exit', code => code === 0 ? resolve() : reject(new Error(`${file} exited with ${code}`)))
})
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => active ? active.kill(signal) : process.exit(0))
if (process.env.AUTO_MIGRATE === 'true') {
  // Storage/Auth own their schemas. Wait until their migrations finish before Petrios SQL.
  for (const name of ['AUTH_INTERNAL_URL','STORAGE_INTERNAL_URL']) {
    if (!process.env[name]) throw new Error(`${name} required for automatic migrations`)
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      try { ready = (await fetch(`${process.env[name]}/${name === 'AUTH_INTERNAL_URL' ? 'health' : 'status'}`, { signal: AbortSignal.timeout(3000) })).ok } catch { /* retry */ }
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    if (!ready) throw new Error(`${name} did not become ready`)
  }
  await run('scripts/migrate.mjs')
}
await run('server.js')
