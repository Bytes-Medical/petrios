'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import { LLM_MODEL } from '@/lib/ai/llm'
import { synthesizeSpeech, TTS_MODEL, TTS_VOICE } from '@/lib/ai/tts'
import { generateRecapScript, AUDIO_RECAP_MAX_SCRIPT_CHARS } from '@/lib/ops/recap'
import { opsEnabled } from '@/lib/ops/flags'
import * as audioRecapsDb from '@/lib/db/audio-recaps'
import * as opsDb from '@/lib/db/ops'
import * as sessionsDb from '@/lib/db/sessions'
import type { AudioRecapMeta } from '@/lib/db/audio-recaps'

/**
 * AI audio recap actions (Petrios Ops surface — OPS_ENABLED=false disables
 * everything here). Moderator flow: generate script → edit/listen → approve;
 * only an approved recap is audible to attendees. Script drafting goes
 * through the audited gateway (purpose 'audio_recap'); speech synthesis
 * through lib/ai/tts.ts, the one sanctioned TTS caller.
 */

async function requireModeratedSession(sessionId: string) {
  await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new Error('Session not found')
  await requireDepartmentModerator(session.department_id)
  return { session, orgId }
}

export async function getAudioRecap(sessionId: string): Promise<AudioRecapMeta | null> {
  if (!opsEnabled()) return null
  await requireModeratedSession(sessionId)
  return audioRecapsDb.findRecapForSession(sessionId)
}

export async function generateAudioRecapScriptAction(
  sessionId: string
): Promise<AudioRecapMeta> {
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled on this deployment')
  const { session, orgId } = await requireModeratedSession(sessionId)

  const synthesis = await opsDb.findSynthesisForSession(sessionId)
  const script = await generateRecapScript({
    sessionTitle: session.title,
    description: session.description,
    tags: session.tags,
    synthesis: synthesis
      ? { themes: synthesis.themes, suggestions: synthesis.suggestions }
      : null,
  })

  if (!script) {
    throw new Error('AI is not configured on this deployment (OPENAI_API_KEY)')
  }

  const recap = await audioRecapsDb.upsertDraftScript({
    orgId,
    sessionId,
    script,
    model: LLM_MODEL,
  })
  revalidatePath(`/sessions/${sessionId}/manage`)
  return recap
}

export async function saveAudioRecapScript(
  sessionId: string,
  script: string
): Promise<void> {
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled on this deployment')
  await requireModeratedSession(sessionId)

  const trimmed = script.trim()
  if (!trimmed) throw new Error('Script cannot be empty')
  if (trimmed.length > AUDIO_RECAP_MAX_SCRIPT_CHARS) {
    throw new Error(`Script must be ${AUDIO_RECAP_MAX_SCRIPT_CHARS} characters or fewer`)
  }

  await audioRecapsDb.updateScript({ sessionId, script: trimmed })
  revalidatePath(`/sessions/${sessionId}/manage`)
}

export async function createAudioRecapAudio(sessionId: string): Promise<void> {
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled on this deployment')
  await requireModeratedSession(sessionId)

  const recap = await audioRecapsDb.findRecapForSession(sessionId)
  if (!recap || recap.status !== 'draft') {
    throw new Error('Generate a draft script first')
  }

  const audio = await synthesizeSpeech({ text: recap.script })
  if (!audio) {
    throw new Error(
      'Speech synthesis is not available on this deployment (no API key, or the configured endpoint has no speech support)'
    )
  }

  await audioRecapsDb.saveAudio({
    sessionId,
    audio,
    ttsModel: TTS_MODEL,
    ttsVoice: TTS_VOICE,
  })
  revalidatePath(`/sessions/${sessionId}/manage`)
}

export async function approveAudioRecap(sessionId: string): Promise<{ success: true }> {
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled on this deployment')
  await requireModeratedSession(sessionId)
  const userId = await requireAuth()

  const approved = await audioRecapsDb.approveRecap({ sessionId, userId })
  if (!approved) {
    throw new Error('Only a draft with audio can be approved — create the audio preview first')
  }

  revalidatePath(`/sessions/${sessionId}/manage`)
  revalidatePath(`/sessions/${sessionId}`)
  return { success: true }
}

/** Attendee-facing check: non-null only when an approved recap with audio
 *  exists and ops is enabled. Any org member may call it. */
export async function getApprovedAudioRecap(
  sessionId: string
): Promise<{ hasAudio: true } | null> {
  if (!opsEnabled()) return null
  await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) return null

  const recap = await audioRecapsDb.findRecapForSession(sessionId)
  return recap && recap.status === 'approved' && recap.audio_bytes ? { hasAudio: true } : null
}
