import { Card } from './Card'
import type { AudioRecapResearchSource } from '@/lib/audio-recap-types'

/** Attendee-facing card for an approved session audio recap. */
export function AudioRecapPlayer({
  sessionId,
  researchSources,
}: {
  sessionId: string
  researchSources: AudioRecapResearchSource[]
}) {
  return (
    <Card>
      <h2 className="mb-1 font-mono text-lg font-bold">Audio Recap</h2>
      <p className="mb-3 font-mono text-xs text-gray-600">
        Approximately five minutes of AI-generated narration, led by the session learning documents
        and reviewed and approved by your organiser.
      </p>
      <audio
        controls
        preload="none"
        src={`/api/sessions/${sessionId}/recap-audio`}
        className="w-full"
      />
      {researchSources.length > 0 ? (
        <details className="mt-4 border-t border-gray-200 pt-3">
          <summary className="cursor-pointer select-none font-mono text-xs font-bold uppercase tracking-wide marker:text-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            Supporting research ({researchSources.length})
          </summary>
          <ul className="mt-2 space-y-1.5 pl-5 font-mono text-xs">
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
        </details>
      ) : null}
    </Card>
  )
}
