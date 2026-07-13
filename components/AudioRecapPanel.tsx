'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from './Badge'
import { Button } from './Button'
import {
  approveAudioRecap,
  createAudioRecapAudio,
  generateAudioRecapScriptAction,
  saveAudioRecapScript,
} from '@/app/actions/audio-recaps'
import type { AudioRecapMeta } from '@/lib/db/audio-recaps'

/**
 * Moderator flow for the AI audio recap: generate script → edit → create
 * audio → listen → approve & publish to attendees. Editing the script
 * clears the audio (server-enforced), so what gets approved is always what
 * was heard.
 */
export function AudioRecapPanel({
  sessionId,
  initialRecap,
}: {
  sessionId: string
  initialRecap: AudioRecapMeta | null
}) {
  const router = useRouter()
  const [script, setScript] = useState(initialRecap?.script ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recap = initialRecap
  const hasAudio = !!recap?.audio_bytes
  const isDraft = recap?.status === 'draft'
  const isApproved = recap?.status === 'approved'
  const scriptDirty = !!recap && script !== recap.script

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    try {
      await fn()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm text-gray-600">
          A 60–90 second spoken recap of this session, drafted by AI from the
          session details and feedback themes. Nothing is audible to
          attendees until you listen and approve it.
        </p>
        {recap ? (
          <Badge variant={isApproved ? 'success' : 'default'}>
            {isApproved ? 'Approved' : 'Draft'}
          </Badge>
        ) : null}
      </div>

      {error && (
        <div className="border border-red-500 bg-red-50 p-3">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      {!recap ? (
        <Button
          type="button"
          disabled={busy !== null}
          onClick={() => run('generate', () => generateAudioRecapScriptAction(sessionId))}
        >
          {busy === 'generate' ? 'Generating…' : 'Generate script'}
        </Button>
      ) : (
        <>
          {isApproved ? (
            <div className="space-y-3">
              <audio controls preload="none" src={`/api/sessions/${sessionId}/recap-audio`} className="w-full" />
              <p className="font-mono text-xs text-gray-600">
                Visible to attendees on the session page.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-gray-500">
                  Script {scriptDirty ? '(unsaved changes)' : ''}
                </label>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={8}
                  maxLength={2500}
                  className="w-full border border-black p-3 font-mono text-sm leading-6"
                />
                <p className="mt-1 font-mono text-xs text-gray-500">
                  Editing the script clears any audio — you always approve
                  exactly what you heard.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null || !scriptDirty}
                  onClick={() => run('save', () => saveAudioRecapScript(sessionId, script))}
                >
                  {busy === 'save' ? 'Saving…' : 'Save script'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null || scriptDirty}
                  onClick={() => run('audio', () => createAudioRecapAudio(sessionId))}
                >
                  {busy === 'audio' ? 'Synthesizing…' : hasAudio ? 'Re-create audio' : 'Create audio preview'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => run('generate', () => generateAudioRecapScriptAction(sessionId))}
                >
                  {busy === 'generate' ? 'Regenerating…' : 'Regenerate script'}
                </Button>
              </div>

              {hasAudio && isDraft ? (
                <div className="space-y-3 border-t border-gray-200 pt-4">
                  <audio controls preload="none" src={`/api/sessions/${sessionId}/recap-audio`} className="w-full" />
                  <Button
                    type="button"
                    disabled={busy !== null || scriptDirty}
                    onClick={() => run('approve', () => approveAudioRecap(sessionId))}
                  >
                    {busy === 'approve' ? 'Approving…' : 'Approve & publish to attendees'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}
