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
        Approximately five minutes, led by the session learning documents and reviewed and approved by your organiser.
      </p>
      <audio
        controls
        preload="none"
        src={`/api/sessions/${sessionId}/recap-audio`}
        className="w-full"
      />
      {researchSources.length > 0 ? (
        <div className="mt-4 border-t border-gray-200 pt-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wide">
            Supporting research
          </h3>
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
        </div>
      ) : null}
    </Card>
  )
}
