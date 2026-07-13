import { Card } from './Card'

/** Attendee-facing card for an approved session audio recap. */
export function AudioRecapPlayer({ sessionId }: { sessionId: string }) {
  return (
    <Card>
      <h2 className="mb-1 font-mono text-lg font-bold">Audio Recap</h2>
      <p className="mb-3 font-mono text-xs text-gray-600">
        AI-generated recap, reviewed and approved by your organiser.
      </p>
      <audio
        controls
        preload="none"
        src={`/api/sessions/${sessionId}/recap-audio`}
        className="w-full"
      />
    </Card>
  )
}
