import { defineConfig } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

// Flat config (ESLint 9) — `next lint` was removed in Next 16, so the lint
// script runs the ESLint CLI directly against this config.
export default defineConfig([
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'coverage/**'] },
  { extends: [...nextCoreWebVitals] },

  // --- Data-access boundary (spec/01, spec/02) -------------------------------
  // Table queries belong in lib/db/. Direct Supabase clients (and the DAL's
  // raw client module) are banned everywhere else, EXCEPT the conscious
  // allow-list below: files whose direct use is auth-plane only
  // (supabase.auth.* — sign-in flows, GoTrue admin lookups) plus lib/auth.ts,
  // the authorization layer itself. Adding a file to the allow-list is a
  // review decision; new code should reach the database through lib/db/.
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: [
      'lib/db/**',
      'lib/supabase/**',
      // Authorization layer (documented exception).
      'lib/auth.ts',
      // Session refresh in the request proxy.
      'proxy.ts',
      // Auth-plane only:
      'lib/notify.ts',
      'components/Nav.tsx',
      'app/actions/auth.ts',
      'app/actions/audit.ts',
      'app/actions/certificates.ts',
      'app/actions/departments.ts',
      'app/actions/emails.ts',
      'app/actions/member-onboarding.ts',
      'app/actions/super-admin.ts',
      'app/signup/page.tsx',
      'app/join/callback/page.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase/server',
              message:
                'Data-plane queries live in lib/db/ (spec/01). If this is genuinely auth-plane (supabase.auth.*), add the file to the allow-list in eslint.config.mjs.',
            },
            {
              name: '@/lib/supabase/client',
              message:
                'Data-plane queries live in lib/db/ (spec/01). If this is genuinely auth-plane (supabase.auth.*), add the file to the allow-list in eslint.config.mjs.',
            },
            {
              name: '@/lib/db/client',
              message:
                'getDb()/getServiceDb() are internal to lib/db/ — add an entity function there instead (lib/db/README.md).',
            },
          ],
        },
      ],
    },
  },
])
