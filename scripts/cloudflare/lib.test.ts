import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CRON_SCHEDULE } from '../../cfw/cron'
import {
  ALL_OR_NONE_SECRET_GROUPS,
  EMPTY_NEXT_ENV_MODULE,
  PRODUCTION_APP_HOST,
  PRODUCTION_CUSTOM_DOMAINS,
  PRODUCTION_ENV,
  PRODUCTION_FORBIDDEN_SECRETS,
  PRODUCTION_OPTIONAL_SECRETS,
  PRODUCTION_REQUIRED_SECRETS,
  PRODUCTION_WORKER_NAME,
  PRODUCTION_ZONE,
  RETIRED_PRODUCTION_ENVS,
  SECRETS_CHANGED_ERROR_CODE,
  STREAMING_BACKPRESSURE_MARKER,
  WORKER_VERSION_ID,
  cronScheduleExpressions,
  customDomainPreviewProblems,
  deployedVersionId,
  deploymentsNewestFirst,
  dirtyPaths,
  domainsForService,
  isLocalEnvFile,
  parseProductionSecretsFile,
  parseSecretList,
  productionConfigProblems,
  productionSecretNameProblems,
  productionSecretsFileProblems,
  productionStateProblems,
  productionVarProblems,
  rollbackDeploymentBody,
  rollbackPlan,
  rollbackProblems,
  routesForScript,
  scheduleExpressions,
  secretsChangedError,
  validateProductionAppUrl,
  versionPlainVars,
  versionSecretNames,
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

  const stagingWorker = {
    name: 'petrios-staging',
    services: [{ binding: 'WORKER_SELF_REFERENCE', service: 'petrios-staging' }],
  }

  it('flags staging configs that could run crons, claim routes or email real users', () => {
    const vars = {
      CRON_ENABLED: 'false',
      OUTBOUND_EMAIL_ENABLED: 'false',
      TRUSTED_CLIENT_IP_HEADER: 'cf-connecting-ip',
      ROTA_INTEGRATION_ENABLED: 'false',
    }
    const safe = { ...stagingWorker, workers_dev: true, triggers: { crons: [] }, vars }
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
    const safe = { ...stagingWorker, workers_dev: true, triggers: { crons: [] }, vars }
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

  it('never deploys the staging config as the production Worker', () => {
    // Custom domains persist across deploys: the live site would get email off and its crons cleared.
    const asProduction = (name: string) =>
      stagingConfigProblems({ ...wranglerConfig, name, services: [{ binding: 'WORKER_SELF_REFERENCE', service: name }] })
    expect(PRODUCTION_WORKER_NAME).toBe('petrios')
    expect(asProduction('petrios')).toEqual([expect.stringMatching(/top-level name must not be the production Worker \(petrios\)/)])
    const renamed = structuredClone(wranglerConfig)
    renamed.env.production.name = 'petrios-live'
    expect(
      stagingConfigProblems({ ...renamed, name: 'petrios-live', services: [{ binding: 'WORKER_SELF_REFERENCE', service: 'petrios-live' }] })
    ).toEqual([expect.stringMatching(/must not be the production Worker \(petrios-live\)/)])
    expect(stagingConfigProblems({ ...wranglerConfig, name: undefined })).toEqual(
      expect.arrayContaining(['top-level name must be set'])
    )
    // The self-reference binding must name the staging Worker itself, never production.
    expect(
      stagingConfigProblems({ ...wranglerConfig, services: [{ binding: 'WORKER_SELF_REFERENCE', service: 'petrios' }] })
    ).toEqual([expect.stringMatching(/top-level services must be exactly/)])
    expect(stagingConfigProblems({ ...wranglerConfig, services: undefined })).toHaveLength(1)
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

  it('is the apex, one of the custom domains, all in one zone; www is not a custom domain', () => {
    expect(PRODUCTION_APP_HOST).toBe('petrios.uk')
    expect(PRODUCTION_CUSTOM_DOMAINS).toEqual(['petrios.uk', 'app.petrios.uk'])
    expect(PRODUCTION_CUSTOM_DOMAINS).toContain(PRODUCTION_APP_HOST)
    expect(PRODUCTION_CUSTOM_DOMAINS.every((host) => host === PRODUCTION_ZONE || host.endsWith(`.${PRODUCTION_ZONE}`))).toBe(true)
    // www.petrios.uk is a zone-level 301 to the apex, not the Worker.
    expect(PRODUCTION_CUSTOM_DOMAINS).not.toContain('www.petrios.uk')
  })
})

describe('production wrangler environment', () => {
  const expectedCrons = Object.keys(CRON_SCHEDULE)
  const committed = wranglerConfig.env[PRODUCTION_ENV]

  /** The committed config with env.production changed (deep copy). */
  function withProduction(change: (env: Record<string, any>) => void) {
    const copy = structuredClone(wranglerConfig)
    change(copy.env[PRODUCTION_ENV])
    return copy
  }

  function problemsOf(config: unknown) {
    return productionConfigProblems(config, { expectedCrons })
  }

  const routeProblems = (routes: unknown) => problemsOf(withProduction((env) => (env.routes = routes)))
  const lacks = (hosts: string) => expect.stringMatching(new RegExp(`routes lacks the custom domain\\(s\\) ${hosts}: .*detach`))
  const unexpected = (entries: string) => expect.stringMatching(new RegExp(`routes has unexpected entries ${entries};`))

  it('accepts the committed wrangler.jsonc', () => {
    expect(problemsOf(wranglerConfig)).toEqual([])
  })

  it('pins the live production facts (2026-10-11)', () => {
    expect(Object.keys(wranglerConfig.env)).toEqual([PRODUCTION_ENV])
    expect(committed.name).toBe('petrios')
    expect(committed.account_id).toBe('610371b5de9811b7d258c7622c23849b')
    expect(committed.routes).toEqual([
      { pattern: 'petrios.uk', custom_domain: true },
      { pattern: 'app.petrios.uk', custom_domain: true },
    ])
    expect(committed.workers_dev).toBe(false)
    expect(committed.preview_urls).toBe(false)
    expect(committed.vars).toEqual({
      APP_URL: 'https://petrios.uk',
      CRON_ENABLED: 'true',
      OUTBOUND_EMAIL_ENABLED: 'true',
      TRUSTED_CLIENT_IP_HEADER: 'cf-connecting-ip',
      HOSTING_PROVIDER: 'cloudflare-workers',
      ROTA_INTEGRATION_ENABLED: 'false',
    })
    expect(committed.secrets.required).toEqual(PRODUCTION_REQUIRED_SECRETS)
  })

  it('refuses a reintroduced production_preflight, or any other environment', () => {
    const preflight = {
      ...structuredClone(committed),
      workers_dev: true,
      routes: [],
      triggers: { crons: [] },
      vars: { ...committed.vars, CRON_ENABLED: 'false', OUTBOUND_EMAIL_ENABLED: 'false' },
    }
    expect(RETIRED_PRODUCTION_ENVS).toEqual(['production_preflight'])
    expect(problemsOf({ ...wranglerConfig, env: { ...wranglerConfig.env, production_preflight: preflight } })).toEqual([
      expect.stringMatching(/env.production_preflight must not exist: .*email-off, cron-less.*custom domains/),
    ])
    expect(problemsOf({ ...wranglerConfig, env: { ...wranglerConfig.env, canary: {} } })).toEqual([
      expect.stringMatching(/unexpected wrangler environments: canary/),
    ])
    expect(problemsOf({ ...wranglerConfig, env: {} })).toEqual(['env.production is missing'])
    expect(problemsOf({ ...wranglerConfig, env: { production_preflight: preflight } })).toEqual([
      expect.stringMatching(/env.production_preflight must not exist/),
      'env.production is missing',
    ])
  })

  it('refuses a plain route, alone or beside the custom domains', () => {
    // The pre-2026-10-11 shape: a Workers route on the proxied DNS record.
    expect(routeProblems([{ pattern: 'petrios.uk/*', zone_name: 'petrios.uk' }])).toEqual([
      lacks('petrios.uk, app.petrios.uk'),
      unexpected('petrios.uk/\\*'),
      expect.stringMatching(/route petrios.uk\/\* is a plain route/),
      expect.stringMatching(/route petrios.uk\/\* must not set zone_name/),
      expect.stringMatching(/route petrios.uk\/\* must be a bare lowercase hostname/),
    ])
    expect(routeProblems([...committed.routes, { pattern: 'petrios.uk/*', zone_name: 'petrios.uk' }])).toEqual(
      expect.arrayContaining([unexpected('petrios.uk/\\*'), expect.stringMatching(/is a plain route/)])
    )
    expect(routeProblems([...committed.routes, 'petrios.uk/*'])).toEqual([
      unexpected('petrios.uk/\\*'),
      expect.stringMatching(/routes entry petrios.uk\/\* is a plain route/),
    ])
    expect(routeProblems([{ pattern: 'petrios.uk', custom_domain: false }, committed.routes[1]])).toEqual([
      expect.stringMatching(/route petrios.uk is a plain route \(custom_domain is not true\)/),
    ])
    expect(problemsOf(withProduction((env) => (env.route = 'petrios.uk/*')))).toEqual(
      expect.arrayContaining([expect.stringMatching(/must not use "route"/)])
    )
  })

  it('refuses a missing, extra, repeated or malformed hostname', () => {
    // Dropping a hostname would detach it and delete its DNS record on the next deploy.
    expect(routeProblems([committed.routes[0]])).toEqual([lacks('app.petrios.uk')])
    expect(routeProblems([committed.routes[1]])).toEqual([lacks('petrios.uk')])
    expect(routeProblems([])).toEqual([expect.stringMatching(/routes must list exactly the custom domains petrios.uk, app.petrios.uk/)])
    expect(routeProblems(undefined)).toHaveLength(1)
    expect(routeProblems([...committed.routes, { pattern: 'www.petrios.uk', custom_domain: true }])).toEqual([
      unexpected('www.petrios.uk'),
    ])
    expect(routeProblems([...committed.routes, committed.routes[0]])).toEqual([
      expect.stringMatching(/lists petrios.uk more than once/),
    ])
    expect(routeProblems([{ pattern: '*.petrios.uk', custom_domain: true }, committed.routes[1]])).toEqual([
      lacks('petrios.uk'),
      unexpected('\\*.petrios.uk'),
      expect.stringMatching(/route \*.petrios.uk must be a bare lowercase hostname/),
    ])
    for (const pattern of ['https://petrios.uk', 'petrios.uk/app', 'petrios.uk:443', 'Petrios.uk', 'petrios.uk.']) {
      expect(routeProblems([{ pattern, custom_domain: true }, committed.routes[1]])).toEqual(
        expect.arrayContaining([expect.stringMatching(/must be a bare lowercase hostname/)])
      )
    }
    expect(routeProblems([{ pattern: 'petrios.uk', custom_domain: true, enabled: false }, committed.routes[1]])).toEqual([
      expect.stringMatching(/route petrios.uk must not set enabled/),
    ])
    expect(routeProblems([{ pattern: 'petrios.uk', custom_domain: true, zone_name: 'petrios.uk' }, committed.routes[1]])).toEqual([
      expect.stringMatching(/route petrios.uk must not set zone_name/),
    ])
  })

  it('keeps APP_URL on the apex custom domain', () => {
    const appUrl = (value: string) => problemsOf(withProduction((env) => (env.vars.APP_URL = value)))
    for (const value of ['https://app.petrios.uk', 'https://www.petrios.uk', 'https://teaching.example.nhs.uk']) {
      expect(appUrl(value)).toEqual([expect.stringMatching(/vars.APP_URL must be https:\/\/petrios.uk/)])
    }
    expect(appUrl('https://petrios.fibrinlab.workers.dev')).toEqual([expect.stringMatching(/workers.dev/)])
    expect(appUrl('http://petrios.uk')).toEqual([expect.stringMatching(/https/)])
    expect(problemsOf(withProduction((env) => delete env.vars.APP_URL))).toEqual([
      expect.stringMatching(/APP_URL is not set/),
    ])
  })

  it('runs exactly CRON_SCHEDULE', () => {
    expect(problemsOf(withProduction((env) => env.triggers.crons.pop()))).toEqual([
      expect.stringMatching(/triggers.crons must equal cfw\/cron.ts CRON_SCHEDULE/),
    ])
    expect(problemsOf(withProduction((env) => env.triggers.crons.push('0 * * * *')))).toHaveLength(1)
    expect(problemsOf(withProduction((env) => env.triggers.crons.push('*/5 * * * *')))).toHaveLength(1)
    // [] would stop every job; an absent key would keep whatever the Worker has.
    expect(problemsOf(withProduction((env) => (env.triggers = { crons: [] })))).toHaveLength(1)
    expect(problemsOf(withProduction((env) => delete env.triggers))).toHaveLength(1)
  })

  it('keeps cron dispatch, email and the Cloudflare vars on', () => {
    const vars = (change: (vars: Record<string, string>) => void) => problemsOf(withProduction((env) => change(env.vars)))
    expect(vars((v) => (v.CRON_ENABLED = 'false'))).toEqual([expect.stringMatching(/vars.CRON_ENABLED must be "true"/)])
    expect(vars((v) => delete v.CRON_ENABLED)).toEqual([expect.stringMatching(/vars.CRON_ENABLED must be "true"/)])
    expect(vars((v) => (v.OUTBOUND_EMAIL_ENABLED = 'false'))).toEqual([
      expect.stringMatching(/vars.OUTBOUND_EMAIL_ENABLED must be "true"/),
    ])
    expect(vars((v) => (v.TRUSTED_CLIENT_IP_HEADER = 'x-forwarded-for'))).toEqual([
      expect.stringMatching(/TRUSTED_CLIENT_IP_HEADER/),
    ])
    expect(vars((v) => delete v.HOSTING_PROVIDER)).toEqual([expect.stringMatching(/HOSTING_PROVIDER/)])
  })

  it('keeps rota availability an explicit owner choice', () => {
    expect(committed.vars.ROTA_INTEGRATION_ENABLED).toBe('false')
    expect(problemsOf(withProduction((env) => (env.vars.ROTA_INTEGRATION_ENABLED = 'true')))).toEqual([])
    expect(problemsOf(withProduction((env) => (env.vars.ROTA_INTEGRATION_ENABLED = 'yes')))).toEqual([
      expect.stringMatching(/vars.ROTA_INTEGRATION_ENABLED must be declared as "false" or "true"/),
    ])
    expect(problemsOf(withProduction((env) => delete env.vars.ROTA_INTEGRATION_ENABLED))).toHaveLength(1)
  })

  it('keeps workers.dev and preview URLs off', () => {
    expect(problemsOf(withProduction((env) => (env.workers_dev = true)))).toEqual([
      expect.stringMatching(/production.workers_dev must be false/),
    ])
    expect(problemsOf(withProduction((env) => delete env.workers_dev))).toHaveLength(1)
    expect(problemsOf(withProduction((env) => (env.preview_urls = true)))).toEqual([
      expect.stringMatching(/preview_urls must be false/),
    ])
  })

  it('requires its own Worker on the pinned account, bound to itself', () => {
    expect(
      problemsOf(withProduction((env) => (env.services = [{ binding: 'WORKER_SELF_REFERENCE', service: 'petrios-staging' }])))
    ).toEqual([expect.stringMatching(/env.production.services/)])
    expect(problemsOf(withProduction((env) => delete env.services))).toEqual([expect.stringMatching(/env.production.services/)])
    expect(problemsOf(withProduction((env) => (env.name = wranglerConfig.name)))).toEqual(
      expect.arrayContaining([expect.stringMatching(/differ from the staging Worker/)])
    )
    expect(
      problemsOf(
        withProduction((env) => {
          env.name = 'petrios-live'
          env.services = [{ binding: 'WORKER_SELF_REFERENCE', service: 'petrios-live' }]
        })
      )
    ).toEqual([expect.stringMatching(/env.production.name must be "petrios"/)])
    expect(problemsOf(withProduction((env) => (env.account_id = 'not-an-account')))).toEqual([
      expect.stringMatching(/production.account_id must pin/),
    ])
    expect(problemsOf(withProduction((env) => delete env.account_id))).toHaveLength(1)
  })

  it('requires the full secret list and nothing outside the production keys', () => {
    expect(problemsOf(withProduction((env) => env.secrets.required.pop()))).toEqual([
      expect.stringMatching(/secrets.required lacks PRIVACY_CONTACT_EMAIL/),
    ])
    expect(problemsOf(withProduction((env) => env.secrets.required.push('APP_URL')))).toEqual([
      expect.stringMatching(/secrets.required names vars: APP_URL/),
    ])
    expect(problemsOf(withProduction((env) => (env.compatibility_date = '2020-01-01')))).toEqual([
      expect.stringMatching(/declares compatibility_date/),
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
  const production = wranglerConfig.env[PRODUCTION_ENV]
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
    expect(productionSecretsFileProblems(filled([...PRODUCTION_REQUIRED_SECRETS, 'ANTHROPIC_API_KEY']), production, outside)).toEqual({
      problems: [],
      unknown: [],
    })
  })

  it('refuses the unfilled template, missing names, nulls and partial groups', () => {
    const fromTemplate = parseProductionSecretsFile(JSON.stringify(template)).entries!
    expect(productionSecretsFileProblems(fromTemplate, production, outside).problems).toEqual([
      expect.stringMatching(/remove or fill the empty values/),
    ])
    const { problems } = productionSecretsFileProblems(
      [
        ...filled(PRODUCTION_REQUIRED_SECRETS.filter((name) => name !== 'RESEND_API_KEY')),
        { name: 'OPS_ENABLED', kind: 'non-string' },
        ...filled(['ELEVENLABS_API_KEY', 'JAAS_APP_ID']),
      ],
      production,
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
      production,
      { ...outside, filePath: '/home/operator/petrios/production-secrets.json' }
    )
    expect(problems).toEqual([
      expect.stringMatching(/must not set APP_URL/),
      expect.stringMatching(/must not set NEXT_PUBLIC_APP_URL.*APP_URL fallback/),
      expect.stringMatching(/outside the repository/),
    ])
    expect(unknown).toEqual(['APP_URL', 'NEXT_PUBLIC_APP_URL', 'ANTHROPIC_APIKEY'])
  })

  it('refuses SMTP names and accepts APP_TIME_ZONE', () => {
    const { problems, unknown } = productionSecretsFileProblems(
      filled([...PRODUCTION_REQUIRED_SECRETS, 'APP_TIME_ZONE', ...PRODUCTION_FORBIDDEN_SECRETS]),
      production,
      outside
    )
    expect(problems).toEqual([expect.stringMatching(/remove SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE/)])
    expect(unknown).toEqual([])
    expect(PRODUCTION_OPTIONAL_SECRETS).toContain('APP_TIME_ZONE')
  })

  it('refuses an ambiguous LLM configuration', () => {
    const names = [...PRODUCTION_REQUIRED_SECRETS, 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']
    expect(productionSecretsFileProblems(filled(names), production, outside).problems).toEqual([
      expect.stringMatching(/LLM_PROVIDER/),
    ])
    expect(productionSecretsFileProblems(filled([...names, 'LLM_PROVIDER']), production, outside).problems).toEqual([])
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

  it('confirms the production state from the API: exactly the custom domains, no routes, exactly the crons', () => {
    const crons = Object.keys(CRON_SCHEDULE)
    const expected = { hostnames: PRODUCTION_CUSTOM_DOMAINS, crons }
    const domains = PRODUCTION_CUSTOM_DOMAINS.map((hostname) => ({ hostname, service: 'petrios' }))
    expect(productionStateProblems({ routes: [], domains, schedules: crons }, expected)).toEqual([])
    expect(productionStateProblems({ routes: [], domains: domains.slice(0, 1), schedules: crons }, expected)).toEqual([
      'custom domains are [petrios.uk], expected [petrios.uk, app.petrios.uk]',
    ])
    expect(
      productionStateProblems(
        { routes: [], domains: [...domains, { hostname: 'www.petrios.uk', service: 'petrios' }], schedules: crons },
        expected
      )
    ).toEqual([expect.stringMatching(/custom domains are \[petrios.uk, app.petrios.uk, www.petrios.uk\]/)])
    expect(productionStateProblems({ routes: [{ pattern: 'petrios.uk/*' }], domains, schedules: crons }, expected)).toEqual([
      'plain routes point at the Worker: petrios.uk/*',
    ])
    // Wrangler sets domains and schedules concurrently after the upload: either can fail alone.
    expect(productionStateProblems({ routes: [], domains, schedules: [] }, expected)).toEqual([
      expect.stringMatching(/cron schedules are \[\], expected/),
    ])
    expect(productionStateProblems({ routes: [], domains: [], schedules: crons.slice(1) }, expected)).toHaveLength(2)
  })

  it('previews the custom-domain change and refuses removals, DNS conflicts and other Workers’ hostnames', () => {
    const target = { workerName: 'petrios', hostnames: PRODUCTION_CUSTOM_DOMAINS }
    const ours = PRODUCTION_CUSTOM_DOMAINS.map((hostname) => ({ hostname, service: 'petrios' }))
    const unchanged = { added: [], removed: [], updated: ours.map((domain) => ({ ...domain, modified: false })), conflicting: [] }
    expect(customDomainPreviewProblems(unchanged, ours, target)).toEqual({ problems: [], notes: [] })

    const removal = { ...unchanged, removed: [{ hostname: 'app.petrios.uk' }] }
    expect(customDomainPreviewProblems(removal, ours, target).problems).toEqual([
      expect.stringMatching(/would DETACH app.petrios.uk from "petrios" and delete the DNS record/),
    ])
    const conflict = { ...unchanged, conflicting: [{ hostname: 'petrios.uk' }] }
    expect(customDomainPreviewProblems(conflict, ours, target).problems).toEqual([
      expect.stringMatching(/petrios.uk already has a DNS record that is not "petrios"'s custom domain/),
    ])
    const stolen = [{ hostname: 'petrios.uk', service: 'petrios' }, { hostname: 'app.petrios.uk', service: 'petrios-staging' }]
    expect(customDomainPreviewProblems(unchanged, stolen, target).problems).toEqual([
      expect.stringMatching(/app.petrios.uk \(Worker "petrios-staging"\) is a custom domain of another Worker/),
    ])
    // Other Workers' unrelated hostnames are not our concern.
    expect(customDomainPreviewProblems(unchanged, [...ours, { hostname: 'docs.example.org', service: 'docs' }], target).problems).toEqual([])

    const reattach = { ...unchanged, added: [{ hostname: 'app.petrios.uk' }], updated: [{ hostname: 'petrios.uk', modified: true }] }
    expect(customDomainPreviewProblems(reattach, ours.slice(0, 1), target)).toEqual({
      problems: [],
      notes: [
        'the deploy will attach app.petrios.uk (configured but not attached now)',
        'the deploy will update the settings of petrios.uk',
      ],
    })
    // Wrangler carries on with an empty changeset when its request fails; the script refuses instead.
    expect(customDomainPreviewProblems(null, ours, target).problems).toEqual([expect.stringMatching(/unexpected API response/)])
    expect(customDomainPreviewProblems({ added: [] }, ours, target).problems).toEqual([
      expect.stringMatching(/lacks removed, updated, conflicting/),
    ])
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

describe('production rollback', () => {
  const v = (n: number) => `0000000${n}-0000-4000-8000-000000000000`
  const deployment = (createdOn: string, versionId: string, triggeredBy?: string, percentage = 100) => ({
    created_on: createdOn,
    versions: [{ version_id: versionId, percentage }],
    ...(triggeredBy ? { annotations: { 'workers/triggered_by': triggeredBy } } : {}),
  })
  const productionVars = {
    APP_URL: 'https://petrios.uk',
    CRON_ENABLED: 'true',
    OUTBOUND_EMAIL_ENABLED: 'true',
    TRUSTED_CLIENT_IP_HEADER: 'cf-connecting-ip',
    HOSTING_PROVIDER: 'cloudflare-workers',
    ROTA_INTEGRATION_ENABLED: 'false',
  }
  const version = (vars: Record<string, string>, secrets = ['CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) => ({
    resources: {
      bindings: [
        ...Object.entries(vars).map(([name, text]) => ({ type: 'plain_text', name, text })),
        ...secrets.map((name) => ({ type: 'secret_text', name })),
        { type: 'service', name: 'WORKER_SELF_REFERENCE', service: 'petrios' },
      ],
    },
  })

  it('accepts only lowercase UUID version ids', () => {
    expect(WORKER_VERSION_ID.test('0bc8e8b8-ec9c-47f1-9ae6-dc1e3f81c35e')).toBe(true)
    for (const id of ['', 'latest', '--yes', '0BC8E8B8-EC9C-47F1-9AE6-DC1E3F81C35E', '0bc8e8b8ec9c47f19ae6dc1e3f81c35e']) {
      expect(WORKER_VERSION_ID.test(id)).toBe(false)
    }
  })

  it('orders the deployment history newest first and rejects other shapes', () => {
    const history = deploymentsNewestFirst({
      deployments: [deployment('2026-10-10T09:00:00Z', v(1)), deployment('2026-10-11T09:00:00Z', v(2)), { created_on: 1 }],
    })
    expect(history?.map((entry: { versions: { version_id: string }[] }) => entry.versions[0].version_id)).toEqual([v(2), v(1)])
    expect(deploymentsNewestFirst({ items: [] })).toBeNull()
  })

  it('picks the previous full-traffic version as wrangler does, and when it stopped serving', () => {
    const history = deploymentsNewestFirst({
      deployments: [
        deployment('2026-10-11T12:00:00Z', v(3)),
        deployment('2026-10-11T10:00:00Z', v(2), 'secret'),
        deployment('2026-10-11T09:00:00Z', v(1)),
        deployment('2026-10-10T09:00:00Z', v(9)),
      ],
    })
    expect(rollbackPlan(history, undefined)).toEqual({
      currentVersionId: v(3),
      targetVersionId: v(2),
      targetServedUntil: '2026-10-11T12:00:00Z',
    })
    expect(rollbackPlan(history, v(1))).toEqual({
      currentVersionId: v(3),
      targetVersionId: v(1),
      targetServedUntil: '2026-10-11T10:00:00Z',
    })
    expect(rollbackPlan(history, v(7)).targetServedUntil).toBeNull()
    expect(rollbackPlan(history, v(3))).toEqual({ error: expect.stringMatching(/already deployed/) })
    expect(rollbackPlan([], undefined)).toEqual({ error: expect.stringMatching(/no deployment history/) })
    expect(rollbackPlan([deployment('2026-10-11T12:00:00Z', v(3))], undefined)).toEqual({
      error: expect.stringMatching(/pass the version id/),
    })
  })

  it('reads plain vars and secret names from a version, never secret values', () => {
    const withValue = { resources: { bindings: [{ type: 'secret_text', name: 'CRON_SECRET', text: 'never-read-secret-value' }] } }
    expect(versionPlainVars(withValue)).toEqual({})
    expect(versionSecretNames(withValue)).toEqual(['CRON_SECRET'])
    expect(versionPlainVars(version(productionVars))).toEqual(productionVars)
    expect(versionPlainVars({})).toBeNull()
  })

  it('allows a production version with the same secret names', () => {
    const plan = { currentVersionId: v(3), targetVersionId: v(2), targetServedUntil: 'x' }
    expect(rollbackProblems(plan, { targetVersion: version(productionVars), currentVersion: version(productionVars) })).toEqual([])
    // Rota is the owner's switch: either value can be restored.
    expect(
      rollbackProblems(plan, {
        targetVersion: version({ ...productionVars, ROTA_INTEGRATION_ENABLED: 'true' }),
        currentVersion: version(productionVars),
      })
    ).toEqual([])
  })

  it('refuses versions that would stop the crons or email, or change secrets, on the live domains', () => {
    const plan = { currentVersionId: v(3), targetVersionId: v(1), targetServedUntil: 'x' }
    const current = version(productionVars)
    // A version from the retired preflight phase.
    expect(
      rollbackProblems(plan, {
        targetVersion: version({ ...productionVars, CRON_ENABLED: 'false', OUTBOUND_EMAIL_ENABLED: 'false' }),
        currentVersion: current,
      })
    ).toEqual([
      expect.stringMatching(/vars.CRON_ENABLED must be "true"/),
      expect.stringMatching(/vars.OUTBOUND_EMAIL_ENABLED must be "true"/),
    ])
    // The empty stub `wrangler secret bulk` creates for a missing Worker.
    expect(rollbackProblems(plan, { targetVersion: version({}, []), currentVersion: current })).toEqual(
      expect.arrayContaining([expect.stringMatching(/different secrets.*lacks CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY/), expect.stringMatching(/APP_URL is not set/)])
    )
    expect(
      rollbackProblems(plan, { targetVersion: version({ ...productionVars, APP_URL: 'https://app.petrios.uk' }), currentVersion: current })
    ).toEqual([expect.stringMatching(/APP_URL must be https:\/\/petrios.uk/)])
    expect(
      rollbackProblems(plan, { targetVersion: version(productionVars, ['CRON_SECRET']), currentVersion: current })
    ).toEqual([expect.stringMatching(/different secrets from the current version; it lacks SUPABASE_SERVICE_ROLE_KEY/)])
    expect(rollbackProblems({ ...plan, targetServedUntil: null }, { targetVersion: current, currentVersion: current })).toEqual([
      expect.stringMatching(/served 100% of traffic in none of the deployments/),
    ])
    expect(rollbackProblems({ error: 'the Worker has no deployment history' }, { targetVersion: null, currentVersion: null })).toEqual([
      'the Worker has no deployment history',
    ])
    expect(rollbackProblems(plan, { targetVersion: {}, currentVersion: current })).toEqual([
      expect.stringMatching(/could not read the secret names/),
      expect.stringMatching(/could not read the vars/),
    ])
  })

  it('applies the same production var rules as the deploy validator', () => {
    expect(productionVarProblems(productionVars, 'vars')).toEqual([])
    expect(productionVarProblems({}, 'vars')).toHaveLength(6)
  })

  it('leaves changed secret values to Cloudflare: the deployment request is never forced', () => {
    // A secret rotated with `versions secret put` + `versions deploy` (a promotion) or in the dashboard leaves
    // no "secret" deployment in the history, so the history cannot be the guard.
    const history = deploymentsNewestFirst({
      deployments: [
        deployment('2026-10-11T14:00:00Z', v(4), 'promotion'),
        deployment('2026-10-11T12:00:00Z', v(1), 'rollback'),
        deployment('2026-10-11T10:00:00Z', v(2)),
        deployment('2026-10-11T09:00:00Z', v(1)),
      ],
    })
    const plan = rollbackPlan(history, v(1))
    expect(plan).toEqual({ currentVersionId: v(4), targetVersionId: v(1), targetServedUntil: '2026-10-11T14:00:00Z' })
    const same = version(productionVars)
    expect(rollbackProblems(plan, { targetVersion: same, currentVersion: same })).toEqual([])

    // The request wrangler rollback sends, minus force: Cloudflare answers 10220 instead of restoring old values.
    const message = `petrios rollback to ${v(1)} from ${v(4)}`
    expect(rollbackDeploymentBody(v(1), message)).toEqual({
      strategy: 'percentage',
      versions: [{ version_id: v(1), percentage: 100 }],
      annotations: { 'workers/message': message },
    })
    expect(rollbackDeploymentBody(v(1), 'x'.repeat(200)).annotations['workers/message']).toHaveLength(120)
    expect(Object.keys(rollbackDeploymentBody(v(1), message))).not.toContain('force')

    expect(SECRETS_CHANGED_ERROR_CODE).toBe(10220)
    const refusal = { code: 10220, message: 'The following secrets have changed: SUPABASE_SERVICE_ROLE_KEY' }
    expect(secretsChangedError([{ code: 10000, message: 'Authentication error' }, refusal])).toEqual(refusal)
    expect(secretsChangedError([{ code: '10220', message: 'x' }])).toEqual({ code: '10220', message: 'x' })
    expect(secretsChangedError([{ code: 10215, message: 'latest version not deployed' }])).toBeNull()
    expect(secretsChangedError(undefined)).toBeNull()
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
