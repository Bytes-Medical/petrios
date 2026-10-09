import 'server-only'
import { resolveLlmProvider, type LlmProvider } from '@/lib/ai/provider'
import { getTtsConfiguration, type TtsProvider } from '@/lib/ai/tts'
import { getMeetingConfig } from '@/lib/meeting/config'
import type { MeetingConfig, MeetingMode } from '@/lib/meeting/types'

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
  /** Label of the active video-room provider (never a secret, at most the configured domain). */
  meetingProvider: string
  /** Active meeting mode (lib/meeting/config.ts); null when the configuration is incomplete. */
  meetingProviderKind: MeetingMode | null
  meetingConfigurationError: boolean
  /**
   * True when Petrios mints room passes (JaaS, or self-hosted Jitsi with JWT),
   * so the provider receives the pass's display name, pseudonymous id and
   * moderator flag.
   */
  meetingRoomPass: boolean
}

export type MeetingProviderDisclosure = Pick<
  ComplianceConfig,
  'meetingProvider' | 'meetingProviderKind' | 'meetingConfigurationError' | 'meetingRoomPass'
>

/**
 * Public label for the resolved meeting configuration (spec/13). Built only
 * from the mode and the non-secret domain: a configuration error is reported
 * as incomplete without its message, and no key or secret is ever read here.
 */
export function describeMeetingProvider(config: MeetingConfig): MeetingProviderDisclosure {
  if (!config.ok) {
    return {
      meetingProvider: 'Video rooms unavailable (incomplete meeting configuration)',
      meetingProviderKind: null,
      meetingConfigurationError: true,
      meetingRoomPass: false,
    }
  }
  const meetingProvider =
    config.mode === 'jaas'
      ? '8x8 Jitsi as a Service (JaaS, 8x8.vc)'
      : config.mode === 'self-hosted'
        ? `Operator-configured Jitsi service (${config.domain})`
        : 'Jitsi Meet (meet.jit.si), opened in a new tab'
  return {
    meetingProvider,
    meetingProviderKind: config.mode,
    meetingConfigurationError: false,
    meetingRoomPass: config.tokenAuth !== 'none',
  }
}

export interface MeetingRegisterEntry {
  purpose: string
  data: string
  status: string
  /** Status chip tone; absent for a descriptive status rendered as plain text. */
  tone?: 'ok' | 'off' | 'attention'
}

const MEETING_MEDIA = 'audio, video, chat, and screen sharing exchanged in the room'

/**
 * The `/subprocessors` register row for the active meeting mode (spec/13): what
 * the meeting provider receives. Room passes never carry an email address
 * (lib/meeting/claims.ts); public mode sends nothing from Petrios.
 */
export function meetingRegisterEntry(disclosure: MeetingProviderDisclosure): MeetingRegisterEntry {
  if (disclosure.meetingConfigurationError) {
    return {
      purpose: 'Optional live video rooms',
      data: 'None while the meeting configuration is incomplete: Petrios Meet rooms stay closed until the operator completes it',
      status: 'Configuration incomplete',
      tone: 'attention',
    }
  }
  if (disclosure.meetingProviderKind === 'public') {
    return {
      purpose: 'Optional live video rooms on the free public Jitsi service, opened in a new browser tab',
      data: `Petrios sends nothing to meet.jit.si. A participant who opens the room link goes to meet.jit.si directly, under Jitsi’s own terms; the room name is derived from the session id, the person who starts the room signs in to Jitsi, and the display name and ${MEETING_MEDIA} are handled by that service`,
      status: 'Used only when a user opens the room link',
    }
  }
  const purpose =
    'Optional live video rooms embedded in the session page and the external-teacher invitation page'
  const status = 'Used when a participant joins an embedded video room'
  if (disclosure.meetingRoomPass) {
    const features =
      disclosure.meetingProviderKind === 'jaas'
        ? 'Room passes turn off recording, live streaming, transcription, phone dial-in/dial-out, and file upload'
        : 'Room passes ask the server to keep recording, live streaming, transcription, phone dial-in/dial-out, and file upload off; the operator’s Jitsi configuration decides whether it enforces that'
    return {
      purpose,
      data: `A short-lived room pass carrying the display name (the Petrios profile name, or the invitation name for an external teacher, never the email address; “Attendee” or “Guest teacher” when none is set), a per-session pseudonymous participant id, and a moderator flag; the room name derived from the session id; the session title as the room subject; and ${MEETING_MEDIA}. ${features}`,
      status,
    }
  }
  return {
    purpose,
    data: `Display name pre-filled from the Petrios profile name, or the invitation name for an external teacher (never the email address; “Attendee” or “Guest teacher” when none is set; editable before joining), the room name derived from the session id, the session title as the room subject, and ${MEETING_MEDIA}`,
    status,
  }
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
    ...describeMeetingProvider(getMeetingConfig()),
  }
}
