'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import { isLlmConfigured, LLM_MODEL } from '@/lib/ai/llm'
import { synthesizeSpeech, TTS_MODEL, TTS_VOICE } from '@/lib/ai/tts'
import { generateRecapScript, AUDIO_RECAP_MAX_SCRIPT_CHARS } from '@/lib/ops/recap'
import {
  getCurrentRecapSourceSnapshot,
  loadRecapSourceFiles,
  recapSourcesAreCurrent,
} from '@/lib/ops/recap-sources'
import { opsEnabled } from '@/lib/ops/flags'
import * as audioRecapsDb from '@/lib/db/audio-recaps'
import * as sessionsDb from '@/lib/db/sessions'
import type { AudioRecapMeta } from '@/lib/db/audio-recaps'
import type { AudioRecapResearchSource } from '@/lib/audio-recap-types'

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
  const [recap, sources] = await Promise.all([
    audioRecapsDb.findRecapForSession(sessionId),
    getCurrentRecapSourceSnapshot(sessionId),
  ])
  return recap
    ? { ...recap, source_stale: !recapSourcesAreCurrent(recap.source_digest, sources) }
    : null
}

export async function generateAudioRecapScriptAction(
  sessionId: string
): Promise<AudioRecapMeta> {
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled on this deployment')
  const { session, orgId } = await requireModeratedSession(sessionId)

  const { snapshot, files } = await loadRecapSourceFiles(sessionId)
  const generated = await generateRecapScript({
    sessionTitle: session.title,
    documents: snapshot.documents,
    files,
  })

  if (!generated) {
    throw new Error(
      isLlmConfigured()
        ? 'The AI provider could not process and research these documents. Confirm that the configured endpoint supports OpenAI Responses file inputs and hosted web search, then try again.'
        : 'AI is not configured on this deployment (OPENAI_API_KEY)'
    )
  }

  const recap = await audioRecapsDb.upsertDraftScript({
    orgId,
    sessionId,
    script: generated.script,
    model: LLM_MODEL,
    sourceDocuments: snapshot.documents,
    sourceDigest: snapshot.digest,
    researchSources: generated.researchSources,
    researchPerformed: true,
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
  const currentSources = await getCurrentRecapSourceSnapshot(sessionId)
  if (!recapSourcesAreCurrent(recap.source_digest, currentSources)) {
    throw new Error('The learning documents changed. Regenerate the recap script before creating audio.')
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

  const [recap, currentSources] = await Promise.all([
    audioRecapsDb.findRecapForSession(sessionId),
    getCurrentRecapSourceSnapshot(sessionId),
  ])
  if (!recap || !recapSourcesAreCurrent(recap.source_digest, currentSources)) {
    throw new Error('The learning documents changed. Regenerate and listen to the recap before approval.')
  }

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
): Promise<{ hasAudio: true; researchSources: AudioRecapResearchSource[] } | null> {
  if (!opsEnabled()) return null
  await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) return null

  const [recap, currentSources] = await Promise.all([
    audioRecapsDb.findRecapForSession(sessionId),
    getCurrentRecapSourceSnapshot(sessionId),
  ])
  return recap &&
    recap.status === 'approved' &&
    recap.audio_bytes &&
    recapSourcesAreCurrent(recap.source_digest, currentSources)
    ? { hasAudio: true, researchSources: recap.research_sources }
    : null
}
