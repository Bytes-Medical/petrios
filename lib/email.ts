/**
 * Transactional email via MailerSend's REST API.
 *
 * Provider-neutral, shape-compatible with the Resend client this replaced, so
 * call sites read the same way:
 *
 *   const mailer = getEmailClient()
 *   const { data, error } = await mailer.emails.send({ from, to, subject, html })
 *   if (error) { ... error.message ... }
 *   // data?.id  -> MailerSend's x-message-id (stored where we kept resend_id)
 *
 * We talk to the REST endpoint directly with fetch rather than pulling in the
 * `mailersend` SDK — one fewer dependency (and dependency-vuln surface) and the
 * payload is trivial. Docs: https://developers.mailersend.com/api/v1/email.html
 *
 * Config (server-only env):
 *   MAILERSEND_API_TOKEN  — API token from https://app.mailersend.com/api-tokens
 *   MAIL_FROM             — default sender as "Name <email@verified-domain>".
 *                           MailerSend only sends from a verified domain (trial
 *                           accounts get a test-*.mlsender.net domain), so there
 *                           is no shared sandbox sender like Resend's resend.dev.
 *
 * Local testing (so you're NOT limited to the trial's single admin recipient):
 *   - With no MAILERSEND_API_TOKEN set, development is a log-only sink: every
 *     send is printed to the server console and reported as success, so the
 *     whole app runs on any email with zero provider config. (Sign-in links are
 *     separately printed by sendPasswordlessLoginLink.)
 *   - MAIL_DEV_REDIRECT="you@example.com" — when you DO want real rendered mail,
 *     set a token plus this and every recipient is rewritten to that one inbox.
 *   - EMAIL_DEV_MODE=true — force the console logging in a production-like build.
 */

const MAILERSEND_ENDPOINT = 'https://api.mailersend.com/v1/email'

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

interface EmailAddress {
  email: string
  name?: string
}

/** Parse "Display Name <user@host>" (or a bare address) into MailerSend's shape. */
function parseAddress(input: string): EmailAddress {
  const match = input.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/)
  if (match) {
    const name = match[1].trim()
    return name ? { email: match[2].trim(), name } : { email: match[2].trim() }
  }
  return { email: input.trim() }
}

function toBase64(content: Buffer | Uint8Array | string): string {
  if (typeof content === 'string') return content // assume already base64
  return Buffer.from(content).toString('base64')
}

const isDev = process.env.NODE_ENV !== 'production'
const DEV_PLACEHOLDER_FROM = 'dev@localhost'

/**
 * Default sender. Reads MAIL_FROM, falling back to the legacy RESEND_FROM_EMAIL
 * during the transition. In production, throws if neither is set so a
 * misconfiguration fails loudly instead of sending from a bogus domain. In
 * development it falls back to a placeholder so local dev needs no email config.
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
        const apiKey = process.env.MAILERSEND_API_TOKEN

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

        const from = parseAddress(params.from)

        // Missing MAIL_FROM resolves to dev@localhost in development. That is
        // intentionally not a real sending address, so keep the app usable by
        // treating it the same as the no-token dev sink instead of sending an
        // invalid from.email to MailerSend.
        if (isDev && from.email === DEV_PLACEHOLDER_FROM) {
          console.log(
            `   ↳ MAIL_FROM not set — dev sink, email not actually sent. Use MAIL_FROM with a verified MailerSend domain for real delivery.\n`
          )
          return { data: { id: null }, error: null }
        }

        // No token: in dev this is a log-only sink so the whole app works on any
        // email with zero provider config; in production it's a hard error.
        if (!apiKey) {
          if (isDev) {
            console.log('   ↳ MAILERSEND_API_TOKEN not set — dev sink, email not actually sent.\n')
            return { data: { id: null }, error: null }
          }
          return {
            data: null,
            error: { message: 'MAILERSEND_API_TOKEN environment variable is required' },
          }
        }

        const recipients = effectiveTo.map((email) => ({ email }))

        const body: Record<string, unknown> = {
          from,
          to: recipients,
          subject: params.subject,
          html: params.html,
        }
        if (params.text) body.text = params.text
        if (params.replyTo) body.reply_to = parseAddress(params.replyTo)
        if (params.attachments?.length) {
          body.attachments = params.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: toBase64(attachment.content),
            disposition: 'attachment',
          }))
        }

        try {
          const response = await fetch(MAILERSEND_ENDPOINT, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify(body),
          })

          if (!response.ok) {
            let message = `MailerSend request failed (${response.status})`
            try {
              const errBody = await response.json()
              if (errBody?.message) message = errBody.message
              if (errBody?.errors) {
                message += `: ${JSON.stringify(errBody.errors)}`
              }
            } catch {
              // non-JSON error body — keep the status-code message
            }
            return { data: null, error: { message } }
          }

          // MailerSend returns 202 Accepted with the id in this header.
          return { data: { id: response.headers.get('x-message-id') }, error: null }
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
