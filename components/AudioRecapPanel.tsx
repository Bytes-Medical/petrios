'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from './Badge'
import { Button } from './Button'
import {
  approveAudioRecap,
  createAudioRecapAudio,
  generateAudioRecapScriptAction,
  saveAudioRecapScript,
} from '@/app/actions/audio-recaps'
import { AUDIO_RECAP_MAX_SCRIPT_CHARS } from '@/lib/audio-recap-types'
import type { AudioRecapMeta } from '@/lib/db/audio-recaps'

function generationStage(progress: number): string {
  if (progress < 20) return 'Preparing and verifying documents'
  if (progress < 50) return 'Reading the learning material'
  if (progress < 78) return 'Researching authoritative sources'
  if (progress < 95) return 'Drafting the five-minute recap'
  return 'Finalising the draft'
}

/**
 * Moderator flow for the AI audio recap: generate script → edit → create
 * audio → listen → approve & publish to attendees. Editing the script
 * clears the audio (server-enforced), so what gets approved is always what
 * was heard.
 */
export function AudioRecapPanel({
  sessionId,
  initialRecap,
  sourceDocumentCount,
}: {
  sessionId: string
  initialRecap: AudioRecapMeta | null
  sourceDocumentCount: number
}) {
  const router = useRouter()
  const [script, setScript] = useState(initialRecap?.script ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generationProgress, setGenerationProgress] = useState(0)
  const progressTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (progressTimer.current !== null) window.clearInterval(progressTimer.current)
  }, [])

  const recap = initialRecap
  const hasAudio = !!recap?.audio_bytes
  const isDraft = recap?.status === 'draft'
  const isApproved = recap?.status === 'approved'
  const sourceStale = recap?.source_stale === true
  const scriptDirty = !!recap && script !== recap.script
  const researchSources = recap?.research_sources ?? []

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

  async function generateFromDocuments() {
    setGenerationProgress(5)
    progressTimer.current = window.setInterval(() => {
      setGenerationProgress((current) => {
        if (current < 20) return Math.min(20, current + 3)
        if (current < 50) return Math.min(50, current + 2)
        if (current < 78) return Math.min(78, current + 1)
        if (current < 94) return Math.min(94, current + 0.5)
        return current
      })
    }, 900)

    try {
      const generated = await generateAudioRecapScriptAction(sessionId)
      setScript(generated.script)
      setGenerationProgress(100)
      await new Promise((resolve) => window.setTimeout(resolve, 350))
    } finally {
      if (progressTimer.current !== null) window.clearInterval(progressTimer.current)
      progressTimer.current = null
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm text-gray-600">
          A detailed, approximately five-minute spoken recap led by the {sourceDocumentCount}{' '}
          currently available learning document{sourceDocumentCount === 1 ? '' : 's'}.
          PDFs contribute extracted text and page images; DOCX and PPTX contribute
          extracted text. Bounded research from authoritative sources adds relevant context,
          while the documents remain the primary focus. Nothing is audible to attendees until
          you listen and approve it.
        </p>
        {recap ? (
          <Badge variant={isApproved && !sourceStale ? 'success' : 'default'}>
            {sourceStale ? 'Sources changed' : isApproved ? 'Approved' : 'Draft'}
          </Badge>
        ) : null}
      </div>

      <p className="border border-amber-700 bg-amber-50 px-3 py-2 font-mono text-xs leading-5 text-amber-900">
        Generating sends the private document contents to this deployment&apos;s configured AI provider.
        Its hosted search may issue queries derived from that material to retrieve public sources.
        Do not use patient-identifiable, confidential, or unnecessary special-category material.
      </p>

      {sourceDocumentCount === 0 && (
        <p className="border border-red-700 bg-red-50 px-3 py-2 font-mono text-sm text-red-800">
          Upload at least one PDF, DOCX, or PPTX in the Documents tab before generating a recap.
        </p>
      )}

      {sourceStale && (
        <p className="border border-amber-700 bg-amber-50 px-3 py-2 font-mono text-sm text-amber-900">
          The available learning documents changed after this recap was generated. Regenerate the
          script; the previous audio is unavailable to attendees.
        </p>
      )}

      {error && (
        <div className="border border-red-500 bg-red-50 p-3">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      {busy === 'generate' && (
        <div className="border border-black bg-white p-3" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-3 font-mono text-xs">
            <span>{generationStage(generationProgress)}</span>
            <span>{Math.round(generationProgress)}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Estimated Audio Recap generation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(generationProgress)}
            className="h-2 overflow-hidden border border-black bg-gray-100"
          >
            <div
              className="h-full bg-black transition-[width] duration-700 ease-out"
              style={{ width: `${generationProgress}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[11px] leading-4 text-gray-500">
            Estimated progress — document size, research, and provider demand affect the actual time.
          </p>
        </div>
      )}

      {researchSources.length > 0 && (
        <section className="border border-gray-300 bg-gray-50 p-3" aria-labelledby="recap-research-sources">
          <h3 id="recap-research-sources" className="font-mono text-xs font-bold uppercase tracking-wide">
            Research sources consulted
          </h3>
          <p className="mt-1 font-mono text-xs leading-5 text-gray-600">
            Public supporting context only; the uploaded learning documents remain the primary source.
            Check researched additions before approval.
          </p>
          <ul className="mt-2 space-y-1.5 font-mono text-xs">
            {researchSources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-words underline decoration-1 underline-offset-2 hover:no-underline"
                >
                  {source.title || source.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!recap ? (
        <Button
          type="button"
          disabled={busy !== null || sourceDocumentCount === 0}
          onClick={() => run('generate', generateFromDocuments)}
        >
          {busy === 'generate' ? 'Generating detailed recap…' : 'Generate detailed recap'}
        </Button>
      ) : (
        <>
          {isApproved ? (
            sourceStale ? (
              <Button
                type="button"
                disabled={busy !== null || sourceDocumentCount === 0}
                onClick={() => run('generate', generateFromDocuments)}
              >
                {busy === 'generate' ? 'Generating detailed recap…' : 'Regenerate detailed recap'}
              </Button>
            ) : (
              <div className="space-y-3">
                <audio controls preload="none" src={`/api/sessions/${sessionId}/recap-audio`} className="w-full" />
                <p className="font-mono text-xs text-gray-600">
                  Visible to attendees on the session page.
                </p>
              </div>
            )
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
                  maxLength={AUDIO_RECAP_MAX_SCRIPT_CHARS}
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
                  disabled={busy !== null || scriptDirty || sourceStale}
                  onClick={() => run('audio', () => createAudioRecapAudio(sessionId))}
                >
                  {busy === 'audio' ? 'Synthesizing…' : hasAudio ? 'Re-create audio' : 'Create audio preview'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null || sourceDocumentCount === 0}
                  onClick={() => run('generate', generateFromDocuments)}
                >
                  {busy === 'generate' ? 'Generating detailed recap…' : 'Regenerate detailed recap'}
                </Button>
              </div>

              {hasAudio && isDraft && !sourceStale ? (
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
