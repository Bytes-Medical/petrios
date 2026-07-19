import { createHash } from 'node:crypto'

/** Stable binding between a spoken script and its five-question catch-up set. */
export function audioRecapScriptDigest(script: string): string {
  return createHash('sha256').update(script.trim(), 'utf8').digest('hex')
}

/**
 * Server-derived duration used by playback evidence. Speech providers do not
 * return a portable duration header, so use the approved 150 wpm narration
 * target and keep the value bounded. This is deliberately not browser input.
 */
export function estimateAudioDurationSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length
  return Math.max(15, Math.min(1800, Math.ceil((words / 150) * 60)))
}

const MPEG1_LAYER3_BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
]
const MPEG2_LAYER3_BITRATES = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
]
const MPEG1_SAMPLE_RATES = [44_100, 48_000, 32_000]

/**
 * Derive MP3 duration from MPEG Layer III frames without another runtime
 * dependency. ElevenLabs and OpenAI both return MP3; summing frame durations
 * works for constant- and variable-bitrate output and avoids trusting a
 * browser-supplied duration for attendance evidence.
 */
export function mp3DurationSeconds(audio: Buffer): number | null {
  let offset = 0
  let seconds = 0
  let frames = 0

  // Skip an ID3v2 tag when present. Its four size bytes are sync-safe.
  if (audio.length >= 10 && audio.subarray(0, 3).toString('ascii') === 'ID3') {
    const size = ((audio[6] & 0x7f) << 21)
      | ((audio[7] & 0x7f) << 14)
      | ((audio[8] & 0x7f) << 7)
      | (audio[9] & 0x7f)
    offset = 10 + size
  }

  while (offset + 4 <= audio.length) {
    if (audio[offset] !== 0xff || (audio[offset + 1] & 0xe0) !== 0xe0) {
      if (frames > 0) break
      offset++
      continue
    }
    const versionBits = (audio[offset + 1] >> 3) & 0x03
    const layerBits = (audio[offset + 1] >> 1) & 0x03
    const bitrateIndex = (audio[offset + 2] >> 4) & 0x0f
    const sampleRateIndex = (audio[offset + 2] >> 2) & 0x03
    const padding = (audio[offset + 2] >> 1) & 0x01
    if (
      versionBits === 1 ||
      layerBits !== 1 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      sampleRateIndex === 3
    ) {
      if (frames > 0) break
      offset++
      continue
    }

    const mpeg1 = versionBits === 3
    const divisor = versionBits === 2 ? 2 : versionBits === 0 ? 4 : 1
    const sampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex] / divisor
    const bitrateKbps = (mpeg1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[bitrateIndex]
    const samplesPerFrame = mpeg1 ? 1152 : 576
    const frameLength = Math.floor(
      ((mpeg1 ? 144 : 72) * bitrateKbps * 1000) / sampleRate
    ) + padding
    if (frameLength <= 4 || offset + frameLength > audio.length) break

    seconds += samplesPerFrame / sampleRate
    frames++
    offset += frameLength
  }

  return frames >= 3 ? Math.ceil(seconds) : null
}
