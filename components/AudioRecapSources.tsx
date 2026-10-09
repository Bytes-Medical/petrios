import type { AudioRecapResearchSource } from '@/lib/audio-recap-types'

/**
 * Hosted-search citations for an approved Audio Recap. Shown wherever
 * attendees can play the recap (session page and Recall catch-up), because the
 * search provider's terms ask that citations accompany the output.
 */
export function AudioRecapSources({ sources }: { sources: AudioRecapResearchSource[] }) {
  if (sources.length === 0) return null
  return (
    <details className="mt-4 border-t border-gray-200 pt-3">
      <summary className="cursor-pointer select-none font-mono text-xs font-bold uppercase tracking-wide marker:text-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        Supporting research ({sources.length})
      </summary>
      <ul className="mt-2 space-y-1.5 pl-5 font-mono text-xs">
        {sources.map((source) => (
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
  )
}
