/**
 * Petrios Ops kill switch. Ops is on by default; setting OPS_ENABLED=false
 * halts every agent surface at once — crons no-op, the gateway throws, the
 * chat and approval actions refuse. Nothing else in the app is affected.
 */
export function opsEnabled(): boolean {
  return process.env.OPS_ENABLED !== 'false'
}

/**
 * The organiser chat assistant is OFF by default — a deliberate deployment
 * decision (free-form chat with tool access needs its own safety review
 * before it ships anywhere). Set OPS_ASSISTANT_ENABLED=true to opt a
 * deployment in; OPS_ENABLED=false still overrides everything.
 */
export function opsAssistantEnabled(): boolean {
  return opsEnabled() && process.env.OPS_ASSISTANT_ENABLED === 'true'
}
