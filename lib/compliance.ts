import 'server-only'
import { resolveLlmProvider, type LlmProvider } from '@/lib/ai/provider'
import { getTtsConfiguration, type TtsProvider } from '@/lib/ai/tts'

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
  /**
   * The LLM provider requests go to (null when AI is disabled). Public notices
   * pick the provider's own data-use and document-storage statement from this
   * rather than matching the display label.
   */
  aiProviderKind: LlmProvider | null
  speechProvider: string
  /**
   * Selected speech provider, independent of the LLM provider (null when
   * speech is off or misconfigured), so notices pick its data-use statement.
   */
  speechProviderKind: TtsProvider | null
  speechEnabled: boolean
  speechConfigurationError: boolean
  meetingProvider: string
}

/**
 * Application-host family. Cloudflare Workers is identified by the
 * `HOSTING_PROVIDER` var in wrangler.jsonc, or by the Workers runtime's own
 * user agent when an operator's config omits it.
 */
export function detectHostingProvider(
  env: Record<string, string | undefined> = process.env,
  userAgent: string | undefined = typeof navigator === 'undefined' ? undefined : navigator.userAgent
): string {
  if (env.RENDER) return 'Render'
  if (env.VERCEL) return 'Vercel'
  if (env.RAILWAY_PROJECT_ID) return 'Railway'
  if (env.HOSTING_PROVIDER?.trim() === 'cloudflare-workers' || userAgent === 'Cloudflare-Workers') {
    return 'Cloudflare Workers'
  }
  return 'Operator-managed application host'
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
  const llm = resolveLlmProvider()
  const aiEnabled = llm.configured
  // OPENAI_BASE_URL is shared by the OpenAI LLM adapter and OpenAI speech.
  const hasCustomOpenAiEndpoint = Boolean(optional('OPENAI_BASE_URL'))
  const speech = getTtsConfiguration()
  const jitsiDomain = optional('JITSI_DOMAIN') || optional('NEXT_PUBLIC_JITSI_DOMAIN') || 'meet.jit.si'

  return {
    controllerName: optional('PRIVACY_CONTROLLER_NAME'),
    controllerAddress: optional('PRIVACY_CONTROLLER_ADDRESS'),
    privacyEmail: optional('PRIVACY_CONTACT_EMAIL'),
    hostingProvider: detectHostingProvider(),
    hostingRegion: optional('DATA_HOSTING_REGION'),
    transferSafeguards: optional('DATA_TRANSFER_SAFEGUARDS'),
    emailProvider: optional('SMTP_HOST')
      ? 'Operator-configured SMTP service'
      : optional('RESEND_API_KEY')
        ? 'Resend'
        : 'No production email provider declared',
    aiProvider: !aiEnabled
      ? 'Disabled'
      : llm.provider === 'anthropic'
        ? optional('ANTHROPIC_BASE_URL')
          ? 'Operator-configured Anthropic-compatible endpoint'
          : 'Anthropic API (Claude)'
        : hasCustomOpenAiEndpoint
          ? 'Operator-configured OpenAI-compatible endpoint'
          : 'OpenAI API',
    aiEnabled,
    aiProviderKind: aiEnabled ? llm.provider : null,
    speechProvider: speech.provider === 'elevenlabs'
      ? 'ElevenLabs API'
      : speech.provider === 'openai'
        ? hasCustomOpenAiEndpoint
          ? 'Operator-configured OpenAI-compatible speech endpoint'
          : 'OpenAI API'
        : speech.configurationError
          ? 'Invalid speech provider configuration'
          : 'Not configured',
    speechProviderKind: speech.configured ? speech.provider : null,
    speechEnabled: speech.configured,
    speechConfigurationError: Boolean(speech.configurationError),
    meetingProvider: jitsiDomain === 'meet.jit.si'
      ? 'Jitsi Meet (meet.jit.si)'
      : `Operator-configured Jitsi service (${jitsiDomain})`,
  }
}
