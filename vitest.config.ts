import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'lib/**/*.test.ts',
      'app/api/cron/**/*.test.ts',
      'cfw/**/*.test.ts',
      'scripts/cloudflare/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
})
