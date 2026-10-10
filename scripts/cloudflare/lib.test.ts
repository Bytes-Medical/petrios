import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CRON_SCHEDULE } from '../../cfw/cron'
import {
  ALL_OR_NONE_SECRET_GROUPS,
  EMPTY_NEXT_ENV_MODULE,
  PREFLIGHT_ENV,
  PRODUCTION_ENV,
  PRODUCTION_FORBIDDEN_SECRETS,
  PRODUCTION_OPTIONAL_SECRETS,
  PRODUCTION_REQUIRED_SECRETS,
  STREAMING_BACKPRESSURE_MARKER,
  cronScheduleExpressions,
  deployedVersionId,
  dirtyPaths,
  domainsForService,
  isLocalEnvFile,
  liveRoutePatterns,
  parseProductionSecretsFile,
  parseSecretList,
  productionConfigProblems,
  productionSecretNameProblems,
  productionSecretsFileProblems,
  productionStateProblems,
  renderResumeTime,
  routesForScript,
  scheduleExpressions,
  validateProductionAppUrl,
  leakCandidates,
  namesFoundIn,
  nextEnvKeyNames,
  parseWranglerConfig,
  patchOpenNextStreamingBackpressure,
  secretsFileNames,
  secretsFileProblems,
  stagingConfigProblems,
  validateStagingAppUrl,
} from './lib.mjs'

const root = path.resolve(__dirname, '..', '..')
const wranglerConfig = parseWranglerConfig(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'))

describe('next-env snapshot', () => {
  it('reports variable names per mode, never values', () => {
    const names = nextEnvKeyNames({
      production: { SUPABASE_SERVICE_ROLE_KEY: 'fake-secret-for-guard-test-1234567890' },
      development: {},
      test: { CRON_SECRET: 'x' },
    })
    expect(names).toEqual(['production.SUPABASE_SERVICE_ROLE_KEY', 'test.CRON_SECRET'])
    expect(names.join()).not.toContain('fake-secret')
  })

  it('scrubs every mode OpenNext can select at runtime', () => {
    expect(EMPTY_NEXT_ENV_MODULE).toBe(
      'export const production = {};\nexport const development = {};\nexport const test = {};\n'
    )
    expect(nextEnvKeyNames({ production: {}, development: {}, test: {} })).toEqual([])
  })

  it('fails loudly if OpenNext stops exporting a mode', () => {
    expect(() => nextEnvKeyNames({ production: {}, development: {} })).toThrow(/"test"/)
  })
})

describe('local env leak candidates', () => {
  it('matches every dotenv variant except the committed example', () => {
    expect(['.env', '.env.local', '.env.production', '.env.staging.local'].every(isLocalEnvFile)).toBe(true)
    expect(['.env.example', '.envrc', 'env', '.dev.vars'].some(isLocalEnvFile)).toBe(false)
  })

  it('skips short values and values already public in .env.example; separates NEXT_PUBLIC_*', () => {
    const { secret, browserPublic } = leakCandidates(
      [
        { name: 'SUPABASE_SERVICE_ROLE_KEY', value: 'fake-secret-for-guard-test-1234567890' },
        { name: 'TTS_PROVIDER', value: 'elevenlabs' },
        { name: 'ELEVENLABS_MODEL_ID', value: 'eleven_multilingual_v2' },
        { name: 'NEXT_PUBLIC_SUPABASE_URL', value: 'https://abcdefgh.supabase.co' },
      ],
      '# ELEVENLABS_MODEL_ID=eleven_multilingual_v2\n'
    )
    expect(secret.map((candidate) => candidate.name)).toEqual(['SUPABASE_SERVICE_ROLE_KEY'])
    expect(browserPublic.map((candidate) => candidate.name)).toEqual(['NEXT_PUBLIC_SUPABASE_URL'])
  })

  it('finds raw and JSON-escaped values in uploaded bytes', () => {
    const { secret } = leakCandidates(
      [
        { name: 'PLAIN', value: 'plain-secret-value-123' },
        { name: 'MULTILINE', value: 'line-one-secret\nline-two' },
        { name: 'ABSENT', value: 'never-bundled-value-456' },
      ],
      ''
    )
    const bundle = [Buffer.from('const a = "plain-secret-value-123";'), Buffer.from('{"k":"line-one-secret\\nline-two"}')]
    expect(namesFoundIn(secret, bundle)).toEqual(['MULTILINE', 'PLAIN'])
  })
})

describe('staging APP_URL', () => {
  it('accepts only the Worker’s own workers.dev origin', () => {
    expect(validateStagingAppUrl('https://petrios-staging.acme-trust.workers.dev', 'petrios-staging')).toEqual({
      origin: 'https://petrios-staging.acme-trust.workers.dev',
    })
    expect(validateStagingAppUrl('https://petrios-staging.acme.workers.dev/', 'petrios-staging').origin).toBe(
      'https://petrios-staging.acme.workers.dev'
    )
  })

  it.each([
    undefined,
    '',
    'petrios-staging.acme.workers.dev',
    'http://petrios-staging.acme.workers.dev',
    'https://localhost:8787',
    'https://petrios.acme.workers.dev',
    'https://teaching.example.nhs.uk',
    'https://petrios-staging.acme.workers.dev.evil.example',
    'https://petrios-staging.acme.workers.dev/login',
    'https://petrios-staging.acme.workers.dev?x=1',
    'https://petrios-staging.acme.workers.dev:8443',
    'https://user:pass@petrios-staging.acme.workers.dev',
  ])('rejects %s', (value) => {
    expect(validateStagingAppUrl(value, 'petrios-staging').error).toBeTruthy()
  })
})

describe('wrangler config checks', () => {
  it('parses JSONC with comments and trailing commas', () => {
    expect(parseWranglerConfig('// c\n{ "name": "x", /* c */ "vars": { "A": "1", }, }')).toEqual({
      name: 'x',
      vars: { A: '1' },
    })
  })

  it('flags staging configs that could run crons, claim routes or email real users', () => {
    const vars = {
      CRON_ENABLED: 'false',
      OUTBOUND_EMAIL_ENABLED: 'false',
      TRUSTED_CLIENT_IP_HEADER: 'cf-connecting-ip',
      ROTA_INTEGRATION_ENABLED: 'false',
    }
    const safe = { workers_dev: true, triggers: { crons: [] }, vars }
    expect(stagingConfigProblems(safe)).toEqual([])
    expect(stagingConfigProblems({ ...safe, triggers: { crons: ['0 * * * *'] } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, triggers: undefined })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, TRUSTED_CLIENT_IP_HEADER: undefined } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, routes: [{ pattern: 'teaching.example/*' }] })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, workers_dev: false })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, CRON_ENABLED: 'true' } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, OUTBOUND_EMAIL_ENABLED: 'true' } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { CRON_ENABLED: 'false' } })).toHaveLength(3)
  })

  it('keeps rota availability off on staging (it serves the production database)', () => {
    const vars = {
      CRON_ENABLED: 'false',
      OUTBOUND_EMAIL_ENABLED: 'false',
      TRUSTED_CLIENT_IP_HEADER: 'cf-connecting-ip',
      ROTA_INTEGRATION_ENABLED: 'false',
    }
    const safe = { workers_dev: true, triggers: { crons: [] }, vars }
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, ROTA_INTEGRATION_ENABLED: 'true' } })).toEqual([
      'top-level vars.ROTA_INTEGRATION_ENABLED must be "false"',
    ])
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, ROTA_INTEGRATION_ENABLED: undefined } })).toHaveLength(1)
    expect(stagingConfigProblems({ ...safe, vars: { ...vars, ROTA_INTEGRATION_ENABLED: 'TRUE' } })).toHaveLength(1)
    expect(wranglerConfig.vars.ROTA_INTEGRATION_ENABLED).toBe('false')
  })

  it('accepts the committed top level (staging) of wrangler.jsonc', () => {
    expect(stagingConfigProblems(wranglerConfig)).toEqual([])
    expect(wranglerConfig.env.production.vars.OUTBOUND_EMAIL_ENABLED).toBe('true')
  })
})

describe('first-deploy secrets file', () => {
  const outside = { filePath: '/home/operator/petrios-staging.secrets', root: '/home/operator/petrios' }
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET']

  it('reads names the way wrangler does, dotenv or JSON, never values', () => {
    const dotenv = [
      '# staging',
      'SUPABASE_URL=https://abcdefgh.supabase.co',
      'export CRON_SECRET="placeholder-cron-secret"',
      'APP_URL: http://localhost:8787',
      "MULTI='line one",
      "line two'",
      '',
    ].join('\r\n')
    expect(secretsFileNames(dotenv)).toEqual({ names: ['SUPABASE_URL', 'CRON_SECRET', 'APP_URL', 'MULTI'] })
    expect(secretsFileNames('{"SUPABASE_URL":"x","CRON_SECRET":"y"}')).toEqual({
      names: ['SUPABASE_URL', 'CRON_SECRET'],
    })
    expect(secretsFileNames('["SUPABASE_URL"]').error).toBeTruthy()
    expect(secretsFileNames('# nothing here\n').error).toBeTruthy()
  })

  it('accepts only the Worker secrets, from a file outside the repository', () => {
    expect(secretsFileProblems([...required, 'OPENAI_API_KEY', 'OUTBOUND_EMAIL_ALLOWLIST'], wranglerConfig, outside)).toEqual([])
  })

  it.each([
    ['APP_URL', /APP_URL/],
    ['CRON_ENABLED', /CRON_ENABLED/],
    ['OUTBOUND_EMAIL_ENABLED', /OUTBOUND_EMAIL_ENABLED/],
    ['SUPABASE_INTERNAL_URL', /never set on Workers/],
    ['NEXTJS_ENV', /never set on Workers/],
    ['NEXT_PUBLIC_APP_URL', /APP_URL fallback/],
  ])('refuses a file that sets %s', (name, reason) => {
    const problems = secretsFileProblems([...required, name], wranglerConfig, outside)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(reason)
  })

  it.each([
    ['/home/operator/petrios/petrios-staging.secrets', /outside the repository/],
    ['/home/operator/petrios/deploy/staging.json', /outside the repository/],
    ['/home/operator/.dev.vars', /local env file/],
    ['/home/operator/.dev.vars.staging', /local env file/],
    ['/home/operator/.env.production', /local env file/],
  ])('refuses %s', (filePath, reason) => {
    const problems = secretsFileProblems(required, wranglerConfig, { filePath, root: outside.root })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(reason)
  })

  it('treats a sibling directory with the same prefix as outside the repository', () => {
    expect(
      secretsFileProblems(required, wranglerConfig, { filePath: '/home/operator/petrios-secrets/s.env', root: outside.root })
    ).toEqual([])
  })
})

describe('production cron schedule source', () => {
  it('reads exactly the CRON_SCHEDULE keys from cfw/cron.ts', () => {
    const source = fs.readFileSync(path.join(root, 'cfw', 'cron.ts'), 'utf8')
    expect(cronScheduleExpressions(source)).toEqual(Object.keys(CRON_SCHEDULE))
  })

  it('fails loudly when CRON_SCHEDULE is no longer a literal', () => {
    expect(() => cronScheduleExpressions('export const CRON_SCHEDULE = build()')).toThrow(/CRON_SCHEDULE/)
    expect(() => cronScheduleExpressions('export const OTHER = {}')).toThrow(/CRON_SCHEDULE/)
  })
})

describe('production APP_URL', () => {
  it('accepts the public https origin', () => {
    expect(validateProductionAppUrl('https://petrios.uk')).toEqual({ origin: 'https://petrios.uk', host: 'petrios.uk' })
    expect(validateProductionAppUrl('https://petrios.uk/').origin).toBe('https://petrios.uk')
    // www.petrios.uk is a Cloudflare 301 to the apex today: it gets no route.
    expect(liveRoutePatterns('petrios.uk')).toEqual(['petrios.uk/*'])
  })

  it.each([
    undefined,
    '',
    'petrios.uk',
    'http://petrios.uk',
    'https://petrios.uk/login',
    'https://petrios.uk?x=1',
    'https://petrios.uk:8443',
    'https://user:pass@petrios.uk',
    'https://PETRIOS.uk',
    'https://petrios.fibrinlab.workers.dev',
    'https://localhost',
    'https://127.0.0.1',
    'https://intranet',
  ])('rejects %s', (value) => {
    expect(validateProductionAppUrl(value).error).toBeTruthy()
  })
})

describe('production wrangler environments', () => {
  const expectedCrons = Object.keys(CRON_SCHEDULE)
  const committedLive = wranglerConfig.env[PRODUCTION_ENV]
  const committedPreflight = wranglerConfig.env[PREFLIGHT_ENV]

  /** The committed config with one environment replaced (deep copy). */
  function withEnv(envName: string, change: (env: Record<string, any>) => void) {
    const copy = structuredClone(wranglerConfig)
    change(copy.env[envName])
    return copy
  }

  function problemsOf(config: unknown) {
    return productionConfigProblems(config, { expectedCrons })
  }

  it('accepts the committed production and preflight environments', () => {
    expect(problemsOf(wranglerConfig)).toEqual([])
  })

  it('pins the committed values the cutover depends on', () => {
    expect(committedLive.name).toBe('petrios')
    expect(committedLive.vars.APP_URL).toBe('https://petrios.uk')
    expect(committedLive.routes).toEqual([{ pattern: 'petrios.uk/*', zone_name: 'petrios.uk' }])
    expect(committedLive.account_id).toMatch(/^[0-9a-f]{32}$/)
    expect(committedPreflight.account_id).toBe(committedLive.account_id)
    expect(committedLive.workers_dev).toBe(false)
    expect(committedPreflight.workers_dev).toBe(true)
    expect(committedLive.secrets.required).toEqual(PRODUCTION_REQUIRED_SECRETS)
    expect(committedPreflight.secrets.required).toEqual(PRODUCTION_REQUIRED_SECRETS)
  })

  it('requires both phases to be one Worker bound to itself', () => {
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.name = 'petrios-preflight')))).toEqual(
      expect.arrayContaining([expect.stringMatching(/same Worker/), expect.stringMatching(/services must be exactly/)])
    )
    expect(
      problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.services = [{ binding: 'WORKER_SELF_REFERENCE', service: 'petrios-staging' }])))
    ).toEqual([expect.stringMatching(/env.production.services/)])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => delete env.services))).toEqual([
      expect.stringMatching(/env.production.services/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.name = wranglerConfig.name)))).toEqual(
      expect.arrayContaining([expect.stringMatching(/differ from the staging Worker/)])
    )
  })

  it('pins one Cloudflare account for both phases', () => {
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => delete env.account_id))).toEqual([
      expect.stringMatching(/production_preflight.account_id must pin/),
      expect.stringMatching(/same account_id/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.account_id = 'f'.repeat(32))))).toEqual([
      expect.stringMatching(/same account_id/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.account_id = 'not-an-account')))).toEqual(
      expect.arrayContaining([expect.stringMatching(/production.account_id must pin/)])
    )
  })

  it('requires exactly one live route, on APP_URL’s host in its zone, never a custom domain', () => {
    const routeProblem = (routes: unknown) => problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.routes = routes)))
    expect(
      routeProblem([
        { pattern: 'petrios.uk/*', zone_name: 'petrios.uk' },
        { pattern: 'www.petrios.uk/*', zone_name: 'petrios.uk' },
      ])
    ).toEqual([expect.stringMatching(/must be exactly petrios.uk\/\* \(APP_URL/)])
    expect(routeProblem([{ pattern: 'staging.petrios.uk/*', zone_name: 'petrios.uk' }])).toEqual([
      expect.stringMatching(/must be exactly/),
    ])
    expect(routeProblem([{ pattern: 'petrios.uk/*', zone_name: 'example.org' }])).toEqual([
      expect.stringMatching(/zone_name example.org does not contain petrios.uk/),
    ])
    expect(routeProblem([{ pattern: 'petrios.uk/*', zone_name: 'petrios.uk', custom_domain: true }])).toEqual([
      expect.stringMatching(/custom_domain would rewrite DNS/),
    ])
    expect(routeProblem(['petrios.uk/*'])).toEqual(
      expect.arrayContaining([expect.stringMatching(/\{ pattern, zone_name \} objects/)])
    )
    expect(routeProblem([])).toEqual([expect.stringMatching(/must list the production routes/)])
  })

  it('ties the routes to APP_URL', () => {
    const moved = withEnv(PRODUCTION_ENV, (env) => (env.vars.APP_URL = 'https://teaching.example.nhs.uk'))
    moved.env[PREFLIGHT_ENV].vars.APP_URL = 'https://teaching.example.nhs.uk'
    expect(problemsOf(moved)).toEqual([
      expect.stringMatching(/must be exactly teaching.example.nhs.uk\/\*/),
      expect.stringMatching(/route petrios.uk\/\*: zone_name petrios.uk does not contain teaching.example.nhs.uk/),
    ])
    expect(
      problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.vars.APP_URL = 'https://petrios.fibrinlab.workers.dev')))
    ).toEqual(expect.arrayContaining([expect.stringMatching(/workers.dev/)]))
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.vars.APP_URL = 'https://www.petrios.uk')))).toEqual([
      expect.stringMatching(/vars.APP_URL must be identical/),
    ])
  })

  it('runs exactly CRON_SCHEDULE in live and clears every schedule in preflight', () => {
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => env.triggers.crons.pop()))).toEqual([
      expect.stringMatching(/triggers.crons must equal cfw\/cron.ts CRON_SCHEDULE/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => env.triggers.crons.push('0 * * * *')))).toHaveLength(1)
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.triggers = { crons: [] })))).toHaveLength(1)
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.triggers = { crons: ['0 * * * *'] })))).toEqual([
      expect.stringMatching(/production_preflight.triggers.crons must be declared as \[\]/),
    ])
    // Absent means "keep the Worker's current schedules": refused.
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => delete env.triggers))).toHaveLength(1)
  })

  it('switches cron dispatch and email per phase only', () => {
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.vars.CRON_ENABLED = 'false')))).toEqual([
      expect.stringMatching(/production.vars.CRON_ENABLED must be "true"/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.vars.OUTBOUND_EMAIL_ENABLED = 'false')))).toEqual([
      expect.stringMatching(/production.vars.OUTBOUND_EMAIL_ENABLED must be "true"/),
    ])
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.vars.CRON_ENABLED = 'true')))).toEqual([
      expect.stringMatching(/production_preflight.vars.CRON_ENABLED must be "false"/),
    ])
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.vars.OUTBOUND_EMAIL_ENABLED = 'true')))).toEqual([
      expect.stringMatching(/production_preflight.vars.OUTBOUND_EMAIL_ENABLED must be "false"/),
    ])
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.vars.TRUSTED_CLIENT_IP_HEADER = 'x-forwarded-for')))).toEqual(
      expect.arrayContaining([expect.stringMatching(/TRUSTED_CLIENT_IP_HEADER/)])
    )
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.vars.APP_TIME_ZONE = 'Europe/London')))).toEqual([
      expect.stringMatching(/same vars keys/),
    ])
  })

  it('keeps rota availability off in preflight and an explicit choice in live', () => {
    expect(committedPreflight.vars.ROTA_INTEGRATION_ENABLED).toBe('false')
    expect(committedLive.vars.ROTA_INTEGRATION_ENABLED).toBe('false')
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.vars.ROTA_INTEGRATION_ENABLED = 'true')))).toEqual([
      expect.stringMatching(/production_preflight.vars.ROTA_INTEGRATION_ENABLED must be "false"/),
    ])
    // Go-live flips only the live value; the phases may differ on this key.
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.vars.ROTA_INTEGRATION_ENABLED = 'true')))).toEqual([])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.vars.ROTA_INTEGRATION_ENABLED = 'yes')))).toEqual([
      expect.stringMatching(/production.vars.ROTA_INTEGRATION_ENABLED must be declared as "false" or "true"/),
    ])
    const absent = withEnv(PRODUCTION_ENV, (env) => delete env.vars.ROTA_INTEGRATION_ENABLED)
    delete absent.env[PREFLIGHT_ENV].vars.ROTA_INTEGRATION_ENABLED
    expect(problemsOf(absent)).toEqual([
      expect.stringMatching(/production_preflight.vars.ROTA_INTEGRATION_ENABLED must be "false"/),
      expect.stringMatching(/production.vars.ROTA_INTEGRATION_ENABLED must be declared/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => delete env.vars.ROTA_INTEGRATION_ENABLED))).toEqual(
      expect.arrayContaining([expect.stringMatching(/same vars keys/)])
    )
  })

  it('keeps preflight off production hostnames and live off workers.dev', () => {
    expect(
      problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.routes = [{ pattern: 'petrios.uk/*', zone_name: 'petrios.uk' }])))
    ).toEqual([expect.stringMatching(/production_preflight.routes must be declared as \[\]/)])
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => delete env.routes))).toHaveLength(1)
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.route = 'petrios.uk/*')))).toEqual(
      expect.arrayContaining([expect.stringMatching(/must not use "route"/)])
    )
    expect(problemsOf(withEnv(PREFLIGHT_ENV, (env) => (env.workers_dev = false)))).toEqual([
      expect.stringMatching(/production_preflight.workers_dev must be true/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.workers_dev = true)))).toEqual([
      expect.stringMatching(/production.workers_dev must be false/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.preview_urls = true)))).toEqual([
      expect.stringMatching(/preview_urls must be false/),
    ])
  })

  it('requires the full secret list in both phases and nothing outside the phase keys', () => {
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => env.secrets.required.pop()))).toEqual([
      expect.stringMatching(/secrets.required lacks PRIVACY_CONTACT_EMAIL/),
      expect.stringMatching(/same secrets/),
    ])
    expect(problemsOf(withEnv(PRODUCTION_ENV, (env) => (env.compatibility_date = '2020-01-01')))).toEqual([
      expect.stringMatching(/declares compatibility_date/),
    ])
    expect(problemsOf({ ...wranglerConfig, env: { ...wranglerConfig.env, canary: {} } })).toEqual([
      expect.stringMatching(/unexpected wrangler environments: canary/),
    ])
    expect(problemsOf({ ...wranglerConfig, env: { [PRODUCTION_ENV]: committedLive } })).toEqual([
      'env.production_preflight is missing',
    ])
  })
})

describe('production Worker secrets (names only)', () => {
  const live = wranglerConfig.env[PRODUCTION_ENV]

  it('parses wrangler secret list JSON, tolerating surrounding noise', () => {
    const stdout = 'noise\n[\n  { "name": "CRON_SECRET", "type": "secret_text" },\n  { "name": "A", "type": "secret_text" }\n]\n'
    expect(parseSecretList(stdout)).toEqual({ names: ['A', 'CRON_SECRET'] })
    expect(parseSecretList('Worker not found').error).toBeTruthy()
    expect(parseSecretList('[{"nope":1}]').error).toBeTruthy()
  })

  it('accepts a Worker with every required secret', () => {
    expect(productionSecretNameProblems([...PRODUCTION_REQUIRED_SECRETS, 'ANTHROPIC_API_KEY'], live, PRODUCTION_ENV)).toEqual(
      []
    )
  })

  it('refuses stored SMTP settings, which would replace Resend', () => {
    expect(productionSecretNameProblems([...PRODUCTION_REQUIRED_SECRETS, 'SMTP_HOST'], live, PRODUCTION_ENV)).toEqual([
      expect.stringMatching(/SMTP_HOST would switch production email from Resend to SMTP.*secret delete <NAME>/),
    ])
  })

  it('names missing secrets, var-shadowing secrets and forbidden names with the fix command', () => {
    const problems = productionSecretNameProblems(
      [...PRODUCTION_REQUIRED_SECRETS.filter((name) => name !== 'MAIL_FROM'), 'CRON_ENABLED', 'SUPABASE_INTERNAL_URL'],
      live,
      PRODUCTION_ENV
    )
    expect(problems).toHaveLength(3)
    expect(problems[0]).toMatch(/missing on petrios: MAIL_FROM.*wrangler secret put <NAME> --env production/)
    expect(problems[1]).toMatch(/CRON_ENABLED shadow vars.*wrangler secret delete <NAME> --env production/)
    expect(problems[2]).toMatch(/SUPABASE_INTERNAL_URL must not exist/)
  })
})

describe('production secrets file', () => {
  const preflight = wranglerConfig.env[PREFLIGHT_ENV]
  const outside = { filePath: '/home/operator/petrios-production-secrets.json', root: '/home/operator/petrios' }
  const template = JSON.parse(
    fs.readFileSync(path.join(root, 'scripts', 'cloudflare', 'production-secrets.template.json'), 'utf8')
  )
  const filled = (names: string[]) => names.map((name) => ({ name, kind: 'set' }))

  it('ships a template with every required and optional name, all empty', () => {
    expect(Object.keys(template).sort()).toEqual([...PRODUCTION_REQUIRED_SECRETS, ...PRODUCTION_OPTIONAL_SECRETS].sort())
    expect(Object.values(template).every((value) => value === '')).toBe(true)
  })

  it('reads value kinds, never values', () => {
    const parsed = parseProductionSecretsFile('{"A":"x-secret-value","B":"  ","C":null,"D":1}')
    expect(parsed).toEqual({
      entries: [
        { name: 'A', kind: 'set' },
        { name: 'B', kind: 'empty' },
        { name: 'C', kind: 'non-string' },
        { name: 'D', kind: 'non-string' },
      ],
    })
    expect(JSON.stringify(parsed)).not.toContain('x-secret-value')
    expect(parseProductionSecretsFile('A=b').error).toMatch(/must be JSON/)
    expect(parseProductionSecretsFile('["A"]').error).toMatch(/JSON object/)
  })

  it('accepts a filled file outside the repository', () => {
    expect(productionSecretsFileProblems(filled([...PRODUCTION_REQUIRED_SECRETS, 'ANTHROPIC_API_KEY']), preflight, outside)).toEqual({
      problems: [],
      unknown: [],
    })
  })

  it('refuses the unfilled template, missing names, nulls and partial groups', () => {
    const fromTemplate = parseProductionSecretsFile(JSON.stringify(template)).entries!
    expect(productionSecretsFileProblems(fromTemplate, preflight, outside).problems).toEqual([
      expect.stringMatching(/remove or fill the empty values/),
    ])
    const { problems } = productionSecretsFileProblems(
      [
        ...filled(PRODUCTION_REQUIRED_SECRETS.filter((name) => name !== 'RESEND_API_KEY')),
        { name: 'OPS_ENABLED', kind: 'non-string' },
        ...filled(['ELEVENLABS_API_KEY', 'JAAS_APP_ID']),
      ],
      preflight,
      outside
    )
    expect(problems).toEqual([
      expect.stringMatching(/lacks required RESEND_API_KEY/),
      expect.stringMatching(/values must be strings: OPS_ENABLED/),
      expect.stringMatching(/ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID or none/),
      expect.stringMatching(/JAAS_APP_ID, JAAS_API_KEY_ID, JAAS_PRIVATE_KEY or none/),
    ])
    expect(ALL_OR_NONE_SECRET_GROUPS).toHaveLength(3)
  })

  it('applies the staging file rules and flags unknown names', () => {
    const { problems, unknown } = productionSecretsFileProblems(
      filled([...PRODUCTION_REQUIRED_SECRETS, 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'ANTHROPIC_APIKEY']),
      preflight,
      { ...outside, filePath: '/home/operator/petrios/production-secrets.json' }
    )
    expect(problems).toEqual([
      expect.stringMatching(/must not set APP_URL/),
      expect.stringMatching(/must not set NEXT_PUBLIC_APP_URL.*APP_URL fallback/),
      expect.stringMatching(/outside the repository/),
    ])
    expect(unknown).toEqual(['APP_URL', 'NEXT_PUBLIC_APP_URL', 'ANTHROPIC_APIKEY'])
  })

  it('refuses SMTP names copied from Render and accepts APP_TIME_ZONE', () => {
    const { problems, unknown } = productionSecretsFileProblems(
      filled([...PRODUCTION_REQUIRED_SECRETS, 'APP_TIME_ZONE', ...PRODUCTION_FORBIDDEN_SECRETS]),
      preflight,
      outside
    )
    expect(problems).toEqual([expect.stringMatching(/remove SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE/)])
    expect(unknown).toEqual([])
    expect(PRODUCTION_OPTIONAL_SECRETS).toContain('APP_TIME_ZONE')
  })

  it('refuses an ambiguous LLM configuration', () => {
    const names = [...PRODUCTION_REQUIRED_SECRETS, 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']
    expect(productionSecretsFileProblems(filled(names), preflight, outside).problems).toEqual([
      expect.stringMatching(/LLM_PROVIDER/),
    ])
    expect(productionSecretsFileProblems(filled([...names, 'LLM_PROVIDER']), preflight, outside).problems).toEqual([])
  })
})

describe('production deploy helpers', () => {
  it('selects only the routes that point at the production Worker', () => {
    const routes = [
      { id: '1', pattern: 'petrios.uk/*', script: 'petrios' },
      { id: '2', pattern: 'www.petrios.uk/*', script: 'petrios' },
      { id: '3', pattern: 'petrios.uk/api/other/*', script: 'other-worker' },
      { id: '4', pattern: 'petrios.uk/static/*' },
    ]
    expect(routesForScript(routes, 'petrios').map((route: { id: string }) => route.id)).toEqual(['1', '2'])
  })

  it('selects only the custom domains and schedules of the production Worker', () => {
    expect(
      domainsForService(
        [
          { hostname: 'petrios.uk', service: 'petrios' },
          { hostname: 'docs.petrios.uk', service: 'docs' },
        ],
        'petrios'
      )
    ).toEqual([{ hostname: 'petrios.uk', service: 'petrios' }])
    expect(domainsForService(null, 'petrios')).toEqual([])
    expect(scheduleExpressions({ schedules: [{ cron: '0 * * * *' }, { cron: '15 * * * *' }] })).toEqual([
      '0 * * * *',
      '15 * * * *',
    ])
    expect(scheduleExpressions({ schedules: [] })).toEqual([])
  })

  it('takes the deployed version from wrangler output, null when the deploy was declined', () => {
    const entry = (fields: object) => JSON.stringify({ version: 1, timestamp: '2026-10-09T10:00:00Z', ...fields })
    expect(deployedVersionId([entry({ type: 'wrangler-session' }), entry({ type: 'deploy', version_id: 'v-1' }), ''].join('\n'))).toBe(
      'v-1'
    )
    expect(deployedVersionId(entry({ type: 'deploy', version_id: null }))).toBeNull()
    expect(deployedVersionId('')).toBeNull()
    expect(deployedVersionId('not json\n')).toBeNull()
  })

  it('confirms the live and preflight state from the API, never a partial one', () => {
    const live = { routePatterns: ['petrios.uk/*'], crons: Object.keys(CRON_SCHEDULE) }
    const routes = [{ pattern: 'petrios.uk/*' }]
    const crons = Object.keys(CRON_SCHEDULE)
    expect(productionStateProblems('live', { routes, domains: [], schedules: crons }, live)).toEqual([])
    // Routes applied but schedules failed (wrangler updates them concurrently), or the reverse.
    expect(productionStateProblems('live', { routes, domains: [], schedules: [] }, live)).toEqual([
      expect.stringMatching(/cron schedules are \[\], expected/),
    ])
    expect(productionStateProblems('live', { routes: [], domains: [], schedules: crons }, live)).toEqual([
      expect.stringMatching(/routes are \[\], expected \[petrios.uk\/\*\]/),
    ])
    expect(productionStateProblems('preflight', { routes: [], domains: [], schedules: [] })).toEqual([])
    expect(
      productionStateProblems('preflight', { routes, domains: [{ hostname: 'petrios.uk' }], schedules: ['0 * * * *'] })
    ).toEqual([
      'custom domains are attached: petrios.uk',
      'routes are still attached: petrios.uk/*',
      'cron schedules remain: 0 * * * *',
    ])
  })

  it('tells the operator when Render may resume: after the longest Worker cron run', () => {
    expect(renderResumeTime(new Date('2026-10-09T10:05:30Z'))).toBe('2026-10-09 10:21 UTC')
    expect(renderResumeTime(new Date('2026-10-09T23:50:00Z'))).toBe('2026-10-10 00:05 UTC')
  })

  it('lists dirty paths from git status --porcelain', () => {
    expect(dirtyPaths(' M wrangler.jsonc\n?? notes.txt\nR  a.ts -> b.ts\n\n')).toEqual([
      'wrangler.jsonc',
      'notes.txt',
      'a.ts -> b.ts',
    ])
    expect(dirtyPaths('')).toEqual([])
  })
})

// The `cloudflare-node` wrapper exactly as OpenNext 4.1.9 + esbuild minify it
// into .open-next/server-functions/default/handler.mjs.
const OPENNEXT_4_1_9_WRAPPER =
  'var NULL_BODY_STATUSES2,handler,cloudflare_node_default,init_cloudflare_node=__esm2({"node_modules/@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js"(){NULL_BODY_STATUSES2=new Set([101,204,205,304]),handler=async(handler3,converter2)=>async(request,env,ctx,abortSignal)=>{globalThis.process=process;for(let[key,value2]of Object.entries(env))typeof value2=="string"&&(process.env[key]=value2);let internalEvent=await converter2.convertFrom(request),url2=new URL(request.url),{promise:promiseResponse,resolve:resolveResponse}=Promise.withResolvers(),streamCreator={writeHeaders(prelude){let{statusCode,cookies,headers}=prelude,responseHeaders=new Headers(headers);for(let cookie of cookies)responseHeaders.append("Set-Cookie",cookie);if(url2.hostname==="localhost"&&responseHeaders.set("Content-Encoding","identity"),NULL_BODY_STATUSES2.has(statusCode)){let response2=new Response(null,{status:statusCode,headers:responseHeaders});return resolveResponse(response2),new Writable({write(chunk,encoding,callback){callback()}})}let controller,readable=new ReadableStream({start(c3){controller=c3}}),response=new Response(readable,{status:statusCode,headers:responseHeaders});return resolveResponse(response),new Writable({write(chunk,encoding,callback){try{controller.enqueue(chunk)}catch(e4){return callback(e4)}callback()},final(callback){controller.close(),callback()},destroy(error2,callback){if(error2)controller.error(error2);else try{controller.close()}catch{}callback(error2)}})},abortSignal,retainChunks:!1};return ctx.waitUntil(handler3(internalEvent,{streamCreator,waitUntil:ctx.waitUntil.bind(ctx)})),promiseResponse},cloudflare_node_default={wrapper:handler,name:"cloudflare-node",supportStreaming:!0}}})'

type StreamCreator = {
  writeHeaders(prelude: { statusCode: number; cookies: string[]; headers: Record<string, string> }): Writable
}
type NextHandler = (event: unknown, options: { streamCreator: StreamCreator }) => Promise<void>
type WorkerFetch = (
  request: Request,
  env: Record<string, string>,
  ctx: { waitUntil(promise: Promise<unknown>): void }
) => Promise<Response>
type Wrapper = (next: NextHandler, converter: { convertFrom(request: Request): Promise<unknown> }) => Promise<WorkerFetch>

function loadWrapper(bundleSource: string): Wrapper {
  const esm = (definition: Record<string, () => void>) => () => Object.values(definition)[0]()
  return new Function('__esm2', 'Writable', `${bundleSource};init_cloudflare_node();return handler`)(esm, Writable)
}

const CHUNK_BYTES = 16 * 1024
const TOTAL_BYTES = 8 * 1024 * 1024

/** A streamed 8 MiB download whose producer honours backpressure the way Next's pipeToNodeResponse does. */
async function startDownload(bundleSource: string) {
  const progress = { produced: 0 }
  const pending: Promise<unknown>[] = []
  const fetchHandler = await loadWrapper(bundleSource)(
    async (_event, { streamCreator }) => {
      const sink = streamCreator.writeHeaders({ statusCode: 200, cookies: [], headers: {} })
      sink.on('error', () => {})
      while (progress.produced < TOTAL_BYTES) {
        progress.produced += CHUNK_BYTES
        if (!sink.write(Buffer.alloc(CHUNK_BYTES))) await once(sink, 'drain')
      }
      sink.end()
    },
    { convertFrom: async () => ({}) }
  )
  const response = await fetchHandler(new Request('https://petrios.example/api/sessions/s/documents/d'), {}, {
    waitUntil: (promise) => void pending.push(promise),
  })
  // The client has not read anything yet.
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { response, progress, producedWhileStalled: progress.produced, pending }
}

describe('OpenNext streaming backpressure patch', () => {
  it('patches the 4.1.9 response writer exactly once, idempotently', () => {
    const patched = patchOpenNextStreamingBackpressure(`before;${OPENNEXT_4_1_9_WRAPPER};after`)
    expect(patched).toContain(STREAMING_BACKPRESSURE_MARKER)
    expect(patched).toContain('pull(){petriosReleaseWrite()}')
    expect(patched.startsWith('before;') && patched.endsWith(';after')).toBe(true)
    expect(patchOpenNextStreamingBackpressure(patched)).toBe(patched)
  })

  it('fails loudly when OpenNext changes the writer or it appears twice', () => {
    expect(() => patchOpenNextStreamingBackpressure('export const nothing = 1')).toThrow(/exactly one/)
    expect(() => patchOpenNextStreamingBackpressure(`${OPENNEXT_4_1_9_WRAPPER};${OPENNEXT_4_1_9_WRAPPER}`)).toThrow(
      /found 2/
    )
    const changed = OPENNEXT_4_1_9_WRAPPER.replace('controller.enqueue(chunk)', 'controller.enqueue(chunk.slice())')
    expect(() => patchOpenNextStreamingBackpressure(changed)).toThrow(/exactly one/)
  })

  it('reproduces the unpatched writer queueing a whole body for a stalled client', async () => {
    const download = await startDownload(OPENNEXT_4_1_9_WRAPPER)
    expect(download.producedWhileStalled).toBe(TOTAL_BYTES)
    expect((await download.response.arrayBuffer()).byteLength).toBe(TOTAL_BYTES)
  })

  it('holds a stalled client to a bounded queue, then delivers every byte', async () => {
    const download = await startDownload(patchOpenNextStreamingBackpressure(OPENNEXT_4_1_9_WRAPPER))
    expect(download.producedWhileStalled).toBeLessThanOrEqual(256 * 1024)
    expect((await download.response.arrayBuffer()).byteLength).toBe(TOTAL_BYTES)
    await Promise.all(download.pending)
    expect(download.progress.produced).toBe(TOTAL_BYTES)
  })

  it('stops the producer when the client goes away', async () => {
    const download = await startDownload(patchOpenNextStreamingBackpressure(OPENNEXT_4_1_9_WRAPPER))
    const reader = download.response.body!.getReader()
    await reader.read()
    await reader.cancel(new Error('client disconnected'))
    const [outcome] = await Promise.allSettled(download.pending)
    expect(outcome.status).toBe('rejected')
    expect(download.progress.produced).toBeLessThan(TOTAL_BYTES)
  })
})
