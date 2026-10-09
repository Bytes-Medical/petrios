import { Card } from './Card'
import { AudioRecapSources } from './AudioRecapSources'
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
      <AudioRecapSources sources={researchSources} />
    </Card>
  )
}
