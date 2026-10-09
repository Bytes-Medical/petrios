// npm run cf:build
import { fail, runBuild } from './tasks.mjs'

try {
  if (!(await runBuild())) process.exitCode = 1
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
