import { defineConfig } from '@playwright/test'

/**
 * Unauthenticated smoke tests (e2e/): pages that must render without a
 * database — the dev server runs against placeholder env, so anything
 * touching Supabase is out of scope here (authed e2e: see ROADMAP.md).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3100',
  },
  webServer: {
    command: 'npm run dev -- --port 3100',
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-placeholder',
      SUPABASE_SERVICE_ROLE_KEY: 'e2e-placeholder',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
    },
  },
})
