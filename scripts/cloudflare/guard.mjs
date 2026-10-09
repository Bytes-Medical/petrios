// Re-runs the pre-deploy secret guard against the current .open-next build.
import { fail, runGuard } from './tasks.mjs'

try {
  if (!(await runGuard())) process.exitCode = 1
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
