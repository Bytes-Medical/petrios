// Cloudflare Cron Trigger -> /api/cron/* dispatch for the custom Worker entry
// (cfw/worker.ts). Pure apart from the injected fetch handler and logger.

export const CRON_JOBS = [
  'session-reminders',
  'post-session-reports',
  'recall-send',
  'recall-awards',
  'ops-synthesis',
  'ops-weekly',
] as const

export type CronJob = (typeof CRON_JOBS)[number]

/**
 * One expression per job, so each job runs as its own invocation with its own
 * CPU budget. Cron Triggers fire in UTC. Cadences follow docs/self-hosting.md.
 * env.production.triggers.crons in wrangler.jsonc must list exactly these keys
 * (the production Worker is the only scheduler; cron.test.ts and
 * scripts/cloudflare/lib.test.ts compare them).
 */
export const CRON_SCHEDULE: Readonly<Record<string, CronJob>> = {
  '0 * * * *': 'session-reminders',
  '15 * * * *': 'post-session-reports',
  '5,20,35,50 * * * *': 'recall-awards',
  '0 8 * * *': 'recall-send',
  '30 6 * * *': 'ops-synthesis',
  '0 7 * * MON': 'ops-weekly',
}

export interface ScheduledEventLike {
  readonly cron: string
}

export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void
}

export interface CronEnv {
  readonly CRON_ENABLED?: string
  readonly CRON_SECRET?: string
  readonly APP_URL?: string
}

export type WorkerFetch<Env, Ctx> = (request: Request, env: Env, ctx: Ctx) => Promise<Response>

type Logger = Pick<Console, 'log' | 'error'>

export function cronJobFor(cron: string): CronJob | null {
  return Object.hasOwn(CRON_SCHEDULE, cron) ? CRON_SCHEDULE[cron] : null
}

function httpOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

export function cronRequest(origin: string, job: CronJob, secret: string): Request {
  return new Request(new URL(`/api/cron/${job}`, origin), {
    headers: { Authorization: `Bearer ${secret}` },
  })
}

/**
 * Only one scheduler may run these jobs against a database (the production
 * Worker), and the staging Worker shares its database, so a Worker dispatches
 * only when CRON_ENABLED is exactly "true" (set solely in the production
 * environment of wrangler.jsonc).
 */
export function createScheduledHandler<Env extends CronEnv, Ctx extends WaitUntilContext>(
  fetchHandler: WorkerFetch<Env, Ctx>,
  logger: Logger = console
) {
  return async function scheduled(event: ScheduledEventLike, env: Env, ctx: Ctx): Promise<void> {
    if (env.CRON_ENABLED !== 'true') {
      logger.log(`[cron] ${event.cron}: CRON_ENABLED is not "true"; not dispatching`)
      return
    }
    const job = cronJobFor(event.cron)
    if (!job) {
      logger.error(`[cron] ${event.cron}: no job is mapped to this expression`)
      return
    }
    if (!env.CRON_SECRET) {
      logger.error(`[cron] ${job}: CRON_SECRET is not set; not dispatching`)
      return
    }
    const origin = httpOrigin(env.APP_URL)
    if (!origin) {
      logger.error(`[cron] ${job}: APP_URL is not an http(s) URL; not dispatching`)
      return
    }

    const label = `[cron] ${event.cron} -> /api/cron/${job}`
    ctx.waitUntil(
      fetchHandler(cronRequest(origin, job, env.CRON_SECRET), env, ctx).then(
        async (response) => {
          await response.body?.cancel()
          if (response.ok) logger.log(`${label}: HTTP ${response.status}`)
          else logger.error(`${label}: HTTP ${response.status}`)
        },
        (error: unknown) => {
          logger.error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        }
      )
    )
  }
}
