import { spawn } from 'node:child_process'
import { configureKeys } from './keys.mjs'
configureKeys()
const child = spawn('node', ['dist/server.js'], { stdio: 'inherit', env: process.env })
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exit(1) })
child.on('exit', code => process.exit(code || 0))
