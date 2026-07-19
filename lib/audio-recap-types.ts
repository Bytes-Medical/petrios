export interface AudioRecapSourceDocument {
  id: string
  filename: string
  mimeType: string
  byteSize: number
  sha256: string
}

export interface AudioRecapResearchSource {
  url: string
  title: string
}

/** Leaves room for a five-minute draft while keeping typical text below the TTS input limit. */
export const AUDIO_RECAP_MAX_SCRIPT_CHARS = 7000
