import { escapeHtml } from './newsletter'

/**
 * Shared wrapper for ops-drafted emails (speaker chases, thank-yous), in the
 * same mono style as the rest of the app's mail. The body text comes from
 * the LLM, so it is escaped — drafts are plain text that gets formatted
 * here, never raw HTML.
 */
export function buildOpsEmailHtml(input: {
  heading: string
  bodyText: string
  ctaLabel?: string
  ctaUrl?: string
}): string {
  const paragraphs = input.bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('')

  const cta =
    input.ctaLabel && input.ctaUrl
      ? `<p style="margin:20px 0;">
           <a href="${input.ctaUrl}" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;text-decoration:none;font-weight:bold;">${escapeHtml(input.ctaLabel)}</a>
         </p>`
      : ''

  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">${escapeHtml(input.heading)}</h2>
      ${paragraphs}
      ${cta}
      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Byte Teaching after review by a teaching programme organiser.
      </p>
    </div>
  `
}
