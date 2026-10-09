// OpenNext adapter config for the Cloudflare Workers build (npm run cf:build).
// No incremental cache: the root layout is force-dynamic, so pages are never
// served from an ISR/SSG cache.
import { defineCloudflareConfig } from '@opennextjs/cloudflare'

export default defineCloudflareConfig()
