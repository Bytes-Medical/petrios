const base = process.env.PETRIOS_INTERNAL_URL
if (!base || !process.env.CRON_SECRET) throw new Error('PETRIOS_INTERNAL_URL and CRON_SECRET are required')
const once = process.argv.includes('--once')
do {
  try {
    const response = await fetch(`${base}/api/internal/scheduler/tick`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(25 * 60 * 1000) })
    if (!response.ok) throw new Error(`Scheduler returned HTTP ${response.status}`)
    console.log('Scheduler tick completed')
  } catch (error) { console.error(error.message); if (once) process.exitCode = 1 }
  if (!once) await new Promise(resolve => setTimeout(resolve, 300000))
} while (!once)
