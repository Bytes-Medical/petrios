// Cloudflare Workers entry (wrangler.jsonc "main"). Built only by `npm run cf:build`;
// the Docker/Node runtime never loads this file.

// Must stay the first import: the yoga redirect has to exist before any PDF render.
import './yoga-install'
import openNextWorker from '../.open-next/worker.js'
import { createScheduledHandler } from './cron'

const worker = {
  fetch: openNextWorker.fetch,
  scheduled: createScheduledHandler(openNextWorker.fetch),
}

export default worker
