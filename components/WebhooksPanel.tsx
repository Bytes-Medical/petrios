'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  createWebhookEndpoint,
  deleteWebhook,
  setWebhookActive,
  type WebhookView,
} from '@/app/actions/api-platform'
import type { WebhookDelivery } from '@/lib/db/api-platform'
import { WEBHOOK_EVENTS } from '@/lib/webhook-events'
import { Badge } from './Badge'
import { Button } from './Button'
import { Input } from './Input'

interface WebhooksPanelProps {
  endpoints: WebhookView[]
  deliveries: WebhookDelivery[]
}

/** Org-admin webhook endpoints: signed event POSTs to your systems. */
export function WebhooksPanel({ endpoints, deliveries }: WebhooksPanelProps) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['session.published'])
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleEvent(event: string) {
    setEvents((current) =>
      current.includes(event) ? current.filter((e) => e !== event) : [...current, event]
    )
  }

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const result = await createWebhookEndpoint(url, events)
      setNewSecret(result.secret)
      setUrl('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add webhook')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-gray-600">
        Receive signed POSTs when events happen (verify the{' '}
        <code>X-Bytes-Signature</code> header — see docs/api.md).
      </p>

      {error && (
        <p className="border border-red-700 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">{error}</p>
      )}

      {newSecret && (
        <div className="border border-green-700 bg-green-50 px-3 py-2">
          <p className="font-mono text-xs font-bold text-green-800">
            Signing secret — copy it now, it will not be shown again:
          </p>
          <p className="mt-1 break-all font-mono text-xs">{newSecret}</p>
          <button type="button" onClick={() => setNewSecret(null)} className="mt-1 font-mono text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-2 border border-black p-4">
        <Input
          label="Endpoint URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-system.example/hooks/byte-teaching"
        />
        <div className="flex flex-wrap gap-2 pt-1">
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-1.5 font-mono text-xs">
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={() => toggleEvent(event)}
              />
              {event}
            </label>
          ))}
        </div>
        <Button size="sm" onClick={handleCreate} disabled={busy || !url.trim()}>
          {busy ? 'Adding…' : 'Add webhook'}
        </Button>
      </div>

      {endpoints.length > 0 && (
        <div className="divide-y divide-gray-200 border border-gray-200">
          {endpoints.map((endpoint) => (
            <div key={endpoint.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-bold">{endpoint.url}</p>
                <p className="font-mono text-xs text-gray-500">
                  {endpoint.events.join(', ')} · secret {endpoint.secret_hint}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={endpoint.active ? 'success' : 'default'}>
                  {endpoint.active ? 'active' : 'paused'}
                </Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await setWebhookActive(endpoint.id, !endpoint.active)
                    router.refresh()
                  }}
                >
                  {endpoint.active ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await deleteWebhook(endpoint.id)
                    router.refresh()
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deliveries.length > 0 && (
        <div>
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-gray-500">
            Recent deliveries
          </h3>
          <div className="divide-y divide-gray-200 border border-gray-200">
            {deliveries.map((delivery) => (
              <div key={delivery.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="font-mono text-xs">
                  {delivery.event} ·{' '}
                  {new Date(delivery.created_at).toLocaleString('en-GB')}
                </span>
                <Badge variant={delivery.status === 'ok' ? 'success' : 'danger'}>
                  {delivery.status}
                  {delivery.response_code ? ` ${delivery.response_code}` : ''}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
