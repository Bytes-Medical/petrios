import 'server-only'

function optional(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

export type ComplianceConfig = {
  controllerName: string | null
  controllerAddress: string | null
  privacyEmail: string | null
  hostingProvider: string
  hostingRegion: string | null
  transferSafeguards: string | null
  emailProvider: string
  aiProvider: string
  aiEnabled: boolean
  meetingProvider: string
}

/**
 * Public, deployment-specific transparency values.
 *
 * Missing facts stay missing: legal notices must not invent a controller,
 * address, hosting region, or transfer mechanism merely to look complete.
 * Public compliance pages render an explicit operator action when a required
 * value is absent.
 */
export function getComplianceConfig(): ComplianceConfig {
  const aiEnabled = Boolean(optional('OPENAI_API_KEY'))
  const hasCustomAiEndpoint = Boolean(optional('OPENAI_BASE_URL'))
  const jitsiDomain = optional('NEXT_PUBLIC_JITSI_DOMAIN') || 'meet.jit.si'

  return {
    controllerName: optional('PRIVACY_CONTROLLER_NAME'),
    controllerAddress: optional('PRIVACY_CONTROLLER_ADDRESS'),
    privacyEmail: optional('PRIVACY_CONTACT_EMAIL'),
    hostingProvider: process.env.RENDER
      ? 'Render'
      : process.env.VERCEL
        ? 'Vercel'
        : 'Operator-managed application host',
    hostingRegion: optional('DATA_HOSTING_REGION'),
    transferSafeguards: optional('DATA_TRANSFER_SAFEGUARDS'),
    emailProvider: optional('SMTP_HOST')
      ? 'Operator-configured SMTP service'
      : optional('RESEND_API_KEY')
        ? 'Resend'
        : 'No production email provider declared',
    aiProvider: !aiEnabled
      ? 'Disabled'
      : hasCustomAiEndpoint
        ? 'Operator-configured OpenAI-compatible endpoint'
        : 'OpenAI API',
    aiEnabled,
    meetingProvider: jitsiDomain === 'meet.jit.si'
      ? 'Jitsi Meet (meet.jit.si)'
      : `Operator-configured Jitsi service (${jitsiDomain})`,
  }
}
