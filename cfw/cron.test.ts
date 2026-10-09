import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CRON_JOBS, CRON_SCHEDULE, createScheduledHandler, cronJobFor, type CronEnv } from './cron'
import { parseWranglerConfig } from '../scripts/cloudflare/lib.mjs'

const root = path.resolve(__dirname, '..')
const wrangler = parseWranglerConfig(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'))

function harness(env: CronEnv, respond: () => Promise<Response> = async () => new Response('{}', { status: 200 })) {
  const fetchHandler = vi.fn<(request: Request) => Promise<Response>>(() => respond())
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) }
  const logger = { log: vi.fn(), error: vi.fn() }
  const scheduled = createScheduledHandler(fetchHandler, logger)
  return {
    fetchHandler,
    logger,
    run: async (cron: string) => {
      await scheduled({ cron }, env, ctx)
      await Promise.all(pending)
    },
  }
}

const enabled: CronEnv = { CRON_ENABLED: 'true', CRON_SECRET: 'test-cron-secret', APP_URL: 'https://petrios.example' }

describe('cron schedule', () => {
  it('maps every cron route in app/api/cron to exactly one expression', () => {
    const routes = fs
      .readdirSync(path.join(root, 'app/api/cron'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect([...CRON_JOBS].sort()).toEqual(routes)
    expect(Object.values(CRON_SCHEDULE).sort()).toEqual(routes)
  })

  it('only targets routes that accept GET with the cron bearer guard', () => {
    for (const job of CRON_JOBS) {
      const source = fs.readFileSync(path.join(root, 'app/api/cron', job, 'route.ts'), 'utf8')
      expect(source).toMatch(/export async function GET\(/)
      expect(source).toMatch(/unauthorizedCronResponse/)
    }
  })

  it('resolves only declared expressions', () => {
    expect(cronJobFor('0 * * * *')).toBe('session-reminders')
    expect(cronJobFor('* * * * *')).toBeNull()
    expect(cronJobFor('constructor')).toBeNull()
  })
})

describe('wrangler.jsonc cron safety', () => {
  it('gives the top-level (staging) Worker no cron triggers, no routes and CRON_ENABLED=false', () => {
    expect(wrangler.triggers).toEqual({ crons: [] })
    expect(wrangler.route).toBeUndefined()
    expect(wrangler.routes).toBeUndefined()
    expect(wrangler.vars.CRON_ENABLED).toBe('false')
  })

  it('declares exactly the scheduled expressions, and CRON_ENABLED=true, only under env.production', () => {
    expect([...wrangler.env.production.triggers.crons].sort()).toEqual(Object.keys(CRON_SCHEDULE).sort())
    expect(wrangler.env.production.vars.CRON_ENABLED).toBe('true')
    const otherEnvs = Object.keys(wrangler.env).filter((name) => name !== 'production')
    expect(otherEnvs).toEqual([])
  })
})

describe('scheduled handler', () => {
  it('refuses to dispatch unless CRON_ENABLED is exactly "true"', async () => {
    for (const CRON_ENABLED of [undefined, 'false', 'TRUE', '1']) {
      const { fetchHandler, logger, run } = harness({ ...enabled, CRON_ENABLED })
      await run('0 * * * *')
      expect(fetchHandler).not.toHaveBeenCalled()
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('CRON_ENABLED is not "true"'))
    }
  })

  it('dispatches the mapped route with the bearer secret and logs the status', async () => {
    const { fetchHandler, logger, run } = harness(enabled)
    await run('15 * * * *')
    expect(fetchHandler).toHaveBeenCalledTimes(1)
    const request = fetchHandler.mock.calls[0][0]
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://petrios.example/api/cron/post-session-reports')
    expect(request.headers.get('authorization')).toBe('Bearer test-cron-secret')
    expect(logger.log).toHaveBeenCalledWith('[cron] 15 * * * * -> /api/cron/post-session-reports: HTTP 200')
  })

  it('logs failed statuses and thrown errors as errors without leaking the secret', async () => {
    const failing = harness(enabled, async () => new Response('nope', { status: 500 }))
    await failing.run('0 8 * * *')
    expect(failing.logger.error).toHaveBeenCalledWith('[cron] 0 8 * * * -> /api/cron/recall-send: HTTP 500')

    const throwing = harness(enabled, async () => {
      throw new Error('boom')
    })
    await throwing.run('0 7 * * MON')
    expect(throwing.logger.error).toHaveBeenCalledWith('[cron] 0 7 * * MON -> /api/cron/ops-weekly: boom')
    for (const call of [...failing.logger.error.mock.calls, ...throwing.logger.error.mock.calls]) {
      expect(String(call[0])).not.toContain('test-cron-secret')
    }
  })

  it('does not dispatch unknown expressions, a missing secret or an invalid APP_URL', async () => {
    const cases: Array<[CronEnv, string]> = [
      [enabled, '* * * * *'],
      [{ ...enabled, CRON_SECRET: '' }, '0 * * * *'],
      [{ ...enabled, APP_URL: '' }, '0 * * * *'],
      [{ ...enabled, APP_URL: 'ftp://petrios.example' }, '0 * * * *'],
    ]
    for (const [env, cron] of cases) {
      const { fetchHandler, logger, run } = harness(env)
      await run(cron)
      expect(fetchHandler).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledTimes(1)
    }
  })
})
