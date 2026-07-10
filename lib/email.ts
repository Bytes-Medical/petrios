/**
 * Transactional email — provider-neutral adapter, so call sites read the same
 * regardless of transport:
 *
 *   const mailer = getEmailClient()
 *   const { data, error } = await mailer.emails.send({ from, to, subject, html })
 *   if (error) { ... error.message ... }
 *   // data?.id  -> provider message id (stored in the resend_id column)
 *
 * Transport selection (server-only env), in priority order:
 *   1. SMTP_HOST set        → SMTP via nodemailer (self-hosted deployments /
 *      trust mail relays). SMTP_PORT (587), SMTP_USER/SMTP_PASS (optional),
 *      SMTP_SECURE=true for implicit TLS (465).
 *   2. RESEND_API_KEY set   → Resend REST API via fetch (no SDK — one fewer
 *      dependency; the payload is trivial).
 *   3. neither, in dev      → log-only sink so the whole app runs with zero
 *      email config.
 *
 * Other config:
 *   MAIL_FROM               — default sender "Name <email@your-domain>"
 *   MAIL_DEV_REDIRECT       — rewrite every recipient to one inbox you control
 *   EMAIL_DEV_MODE=true     — force console logging in a production-like build
 */

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

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

// SMTP transporter is created once per process; nodemailer pools connections.
let smtpTransport: Transporter | null = null

function getSmtpTransport(): Transporter {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  }
  return smtpTransport
}

async function sendViaSmtp(
  params: SendEmailParams,
  effectiveTo: string[]
): Promise<SendEmailResult> {
  try {
    const info = await getSmtpTransport().sendMail({
      from: params.from,
      to: effectiveTo,
      subject: params.subject,
      html: params.html,
      text: params.text,
      replyTo: params.replyTo,
      attachments: params.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content:
          typeof attachment.content === 'string'
            ? Buffer.from(attachment.content, 'base64')
            : Buffer.from(attachment.content),
      })),
    })
    return { data: { id: info.messageId ?? null }, error: null }
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : 'SMTP send failed' },
    }
  }
}

export function getEmailClient() {
  return {
    emails: {
      async send(params: SendEmailParams): Promise<SendEmailResult> {
        const smtpConfigured = !!process.env.SMTP_HOST
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

        // Self-hosted SMTP takes priority: local relays (or mailpit in dev)
        // accept any sender, so the placeholder-from guard doesn't apply.
        if (smtpConfigured) {
          return sendViaSmtp(params, effectiveTo)
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

        // No transport at all: in dev this is a log-only sink so the whole app
        // works with zero provider config; in production it's a hard error.
        if (!apiKey) {
          if (isDev) {
            console.log('   ↳ No SMTP_HOST or RESEND_API_KEY set — dev sink, email not actually sent.\n')
            return { data: { id: null }, error: null }
          }
          return {
            data: null,
            error: { message: 'Configure SMTP_HOST (self-hosted) or RESEND_API_KEY to send email' },
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
