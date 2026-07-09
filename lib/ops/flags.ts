/**
 * Bytes Ops kill switch. Ops is on by default; setting OPS_ENABLED=false
 * halts every agent surface at once — crons no-op, the gateway throws, the
 * chat and approval actions refuse. Nothing else in the app is affected.
 */
export function opsEnabled(): boolean {
  return process.env.OPS_ENABLED !== 'false'
}
