/**
 * Transactional email via Resend's REST API.
 *
 * Provider-neutral wrapper, so call sites read the same regardless of provider:
 *
 *   const mailer = getEmailClient()
 *   const { data, error } = await mailer.emails.send({ from, to, subject, html })
 *   if (error) { ... error.message ... }
 *   // data?.id  -> Resend's email id (stored in the resend_id column)
 *
 * We talk to the REST endpoint directly with fetch rather than pulling in the
 * `resend` SDK — one fewer dependency (and dependency-vuln surface) and the
 * payload is trivial. Docs: https://resend.com/docs/api-reference/emails/send-email
 *
 * Config (server-only env):
 *   RESEND_API_KEY  — API key from https://resend.com/api-keys ("re_..." prefix)
 *   MAIL_FROM       — default sender as "Name <email@your-domain>". For zero-setup
 *                     testing Resend offers a shared sandbox sender,
 *                     "onboarding@resend.dev", which sends without verifying a
 *                     domain but only delivers to your own account email.
 *
 * Local testing:
 *   - With no RESEND_API_KEY set, development is a log-only sink: every send is
 *     printed to the server console and reported as success, so the whole app
 *     runs on any email with zero provider config. (Sign-in links are separately
 *     printed by sendPasswordlessLoginLink.)
 *   - MAIL_DEV_REDIRECT="you@example.com" — when you DO want real rendered mail,
 *     set a key plus this and every recipient is rewritten to that one inbox.
 *   - EMAIL_DEV_MODE=true — force the console logging in a production-like build.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

interface EmailAttachment {
  filename: string
  /** Raw bytes (Buffer/Uint8Array) or an already-base64-encoded string. */
  content: Buffer | Uint8Array | string
}

interface SendEmailParams {
  from: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
  attachments?: EmailAttachment[]
}

interface SendEmailResult {
  data: { id: string | null } | null
  error: { message: string } | null
}

/** Pull the bare address out of "Display Name <user@host>" (or a bare address). */
function parseEmail(input: string): string {
  const match = input.match(/^\s*.*?\s*<\s*([^>]+)\s*>\s*$/)
  return (match ? match[1] : input).trim()
}

function toBase64(content: Buffer | Uint8Array | string): string {
  if (typeof content === 'string') return content // assume already base64
  return Buffer.from(content).toString('base64')
}

const isDev = process.env.NODE_ENV !== 'production'
const DEV_PLACEHOLDER_FROM = 'dev@localhost'

/**
 * Default sender. Reads MAIL_FROM, falling back to the legacy RESEND_FROM_EMAIL.
 * In production, throws if neither is set so a misconfiguration fails loudly
 * instead of sending from a bogus domain. In development it falls back to a
 * placeholder so local dev needs no email config.
 */
export function getFromAddress(): string {
  const from = process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL
  if (from) return from
  if (isDev) return 'Byte Teaching <dev@localhost>'
  throw new Error(
    'MAIL_FROM environment variable is required (e.g. "Byte Teaching <no-reply@your-domain>")'
  )
}

export function getEmailClient() {
  return {
    emails: {
      async send(params: SendEmailParams): Promise<SendEmailResult> {
        const apiKey = process.env.RESEND_API_KEY

        // Optional dev redirect: funnel every recipient to one inbox you control
        // (e.g. to see rendered HTML/attachments) without spamming real users.
        const redirect = process.env.MAIL_DEV_REDIRECT
        const originalTo = (Array.isArray(params.to) ? params.to : [params.to]).filter(Boolean)
        const effectiveTo = redirect ? [redirect] : originalTo

        if (isDev || process.env.EMAIL_DEV_MODE === 'true') {
          const att = params.attachments?.length ? ` | ${params.attachments.length} attachment(s)` : ''
          const red = redirect ? ` (redirected → ${redirect})` : ''
          console.log(
            `\n📧 [email] to=${originalTo.join(', ')}${red} | subject="${params.subject}"${att}`
          )
        }

        // Missing MAIL_FROM resolves to dev@localhost in development. That is
        // intentionally not a real sending address, so keep the app usable by
        // treating it the same as the no-key dev sink instead of sending an
        // invalid from address to Resend.
        if (isDev && parseEmail(params.from) === DEV_PLACEHOLDER_FROM) {
          console.log(
            `   ↳ MAIL_FROM not set — dev sink, email not actually sent. Use MAIL_FROM with a Resend-verified domain (or onboarding@resend.dev) for real delivery.\n`
          )
          return { data: { id: null }, error: null }
        }

        // No key: in dev this is a log-only sink so the whole app works on any
        // email with zero provider config; in production it's a hard error.
        if (!apiKey) {
          if (isDev) {
            console.log('   ↳ RESEND_API_KEY not set — dev sink, email not actually sent.\n')
            return { data: { id: null }, error: null }
          }
          return {
            data: null,
            error: { message: 'RESEND_API_KEY environment variable is required' },
          }
        }

        const body: Record<string, unknown> = {
          from: params.from,
          to: effectiveTo,
          subject: params.subject,
          html: params.html,
        }
        if (params.text) body.text = params.text
        if (params.replyTo) body.reply_to = params.replyTo
        if (params.attachments?.length) {
          body.attachments = params.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: toBase64(attachment.content),
          }))
        }

        try {
          const response = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          })

          const payload = await response.json().catch(() => null)

          if (!response.ok) {
            const message =
              payload?.message ||
              payload?.error?.message ||
              `Resend request failed (${response.status})`
            return { data: null, error: { message } }
          }

          // Resend returns 200 with the email id in the JSON body.
          return { data: { id: payload?.id ?? null }, error: null }
        } catch (err) {
          return {
            data: null,
            error: { message: err instanceof Error ? err.message : 'Unknown email error' },
          }
        }
      },
    },
  }
}
