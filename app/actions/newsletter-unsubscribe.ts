'use server'

import { redirect } from 'next/navigation'
import { verifyUnsubToken } from '@/lib/ops/newsletter'
import * as opsDb from '@/lib/db/ops'

/**
 * PUBLIC newsletter preference actions, posted from the confirmation page at
 * /ops/unsubscribe/[token]. The HMAC token is the only credential (it binds
 * the organization and the member). A GET of that page never changes state,
 * so mail link scanners and prefetchers cannot opt a member out; only these
 * explicit form posts (and the RFC 8058 one-click POST route) do. Expected
 * outcomes are shown by redirecting back to the page with a `state` value,
 * never by throwing (Next masks thrown messages in production).
 */

function pagePath(token: string, state?: 'error'): string {
  const path = `/ops/unsubscribe/${encodeURIComponent(token)}`
  return state ? `${path}?state=${state}` : path
}

async function changeNewsletterPreference(formData: FormData, optOut: boolean): Promise<never> {
  const token = String(formData.get('token') ?? '')
  const verified = verifyUnsubToken(token)
  if (!verified) redirect(pagePath(token))
  try {
    if (optOut) await opsDb.insertNewsletterOptout(verified.orgId, verified.userId)
    else await opsDb.deleteNewsletterOptout(verified.orgId, verified.userId)
  } catch (error) {
    console.error('Failed to record newsletter preference:', error)
    redirect(pagePath(token, 'error'))
  }
  redirect(pagePath(token))
}

export async function confirmNewsletterUnsubscribe(formData: FormData): Promise<void> {
  await changeNewsletterPreference(formData, true)
}

export async function resubscribeToNewsletter(formData: FormData): Promise<void> {
  await changeNewsletterPreference(formData, false)
}
