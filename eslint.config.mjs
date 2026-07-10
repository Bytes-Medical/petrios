import { defineConfig } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

// Flat config (ESLint 9) — `next lint` was removed in Next 16, so the lint
// script runs the ESLint CLI directly against this config.
export default defineConfig([
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'coverage/**'] },
  { extends: [...nextCoreWebVitals] },
])
