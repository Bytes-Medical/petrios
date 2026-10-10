import { decodeHexJsonValueBody } from '@/lib/audio-hex-stream'
import { getPublicRuntimeConfig } from '@/lib/runtime-config'
import { getServiceDb } from './client'
import { toDbError } from './errors'
import type {
  AudioRecapResearchSource,
  AudioRecapSourceDocument,
} from '@/lib/audio-recap-types'

/**
 * Audio recaps DAL (audio_recaps, deny-all RLS). Service role justification:
 * mutations are requireDepartmentModerator-gated in
 * app/actions/audio-recaps.ts; the read paths are the org-scoped streaming
 * route /api/sessions/[id]/recap-audio and the identity-bound
 * /api/recall/[token]/audio.
 *
 * Blob discipline: the `audio` BYTEA column is NEVER part of metadata reads
 * (META_COLUMNS) — a 5-minute MP3 is megabytes and PostgREST hex-encodes it.
 * Approval-gate integrity: editing a script clears the audio, and approval
 * requires audio present, so an approved recap is always exactly the audio
 * the moderator listened to.
 */

const META_COLUMNS =
  'id, org_id, session_id, script, script_digest, model, tts_provider, tts_model, tts_voice, audio_bytes, audio_revision, audio_duration_seconds, source_documents, source_digest, research_sources, research_performed, status, approved_by, approved_at, created_at, updated_at'

export interface AudioRecapMeta {
  id: string
  org_id: string
  session_id: string
  script: string
  script_digest: string | null
  model: string | null
  tts_provider: 'openai' | 'elevenlabs' | null
  tts_model: string | null
  tts_voice: string | null
  audio_bytes: number | null
  audio_revision: number
  audio_duration_seconds: number | null
  source_documents: AudioRecapSourceDocument[]
  source_digest: string | null
  research_sources: AudioRecapResearchSource[]
  research_performed: boolean
  /** Computed by the authorized action; not stored in the table. */
  source_stale?: boolean
  status: 'draft' | 'approved'
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export async function findRecapForSession(sessionId: string): Promise<AudioRecapMeta | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('audio_recaps')
    .select(META_COLUMNS)
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch audio recap', error)
  return (data as AudioRecapMeta | null) ?? null
}

/** Create or replace the draft script; always resets to an unapproved,
 *  audio-less draft. */
export async function upsertDraftScript(input: {
  orgId: string
  sessionId: string
  script: string
  scriptDigest: string
  model: string | null
  sourceDocuments: AudioRecapSourceDocument[]
  sourceDigest: string
  researchSources: AudioRecapResearchSource[]
  researchPerformed: boolean
}): Promise<AudioRecapMeta> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('audio_recaps')
    .upsert(
      {
        org_id: input.orgId,
        session_id: input.sessionId,
        script: input.script,
        script_digest: input.scriptDigest,
        model: input.model,
        source_documents: input.sourceDocuments,
        source_digest: input.sourceDigest,
        research_sources: input.researchSources,
        research_performed: input.researchPerformed,
        audio: null,
        audio_bytes: null,
        audio_duration_seconds: null,
        tts_provider: null,
        tts_model: null,
        tts_voice: null,
        status: 'draft',
        approved_by: null,
        approved_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' }
    )
    .select(META_COLUMNS)
    .single()

  if (error) throw toDbError('Failed to store recap script', error)
  return data as AudioRecapMeta
}

/** Draft-only script edit; clears any audio (stale-audio guard). */
export async function updateScript(input: {
  sessionId: string
  script: string
  scriptDigest: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('audio_recaps')
    .update({
      script: input.script,
      script_digest: input.scriptDigest,
      audio: null,
      audio_bytes: null,
      audio_duration_seconds: null,
      tts_provider: null,
      tts_model: null,
      tts_voice: null,
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', input.sessionId)
    .eq('status', 'draft')

  if (error) throw toDbError('Failed to update recap script', error)
}

export async function saveAudio(input: {
  sessionId: string
  audio: Buffer
  ttsProvider: 'openai' | 'elevenlabs'
  ttsModel: string
  ttsVoice: string
  durationSeconds: number
}): Promise<void> {
  const db = await getServiceDb()
  const { data: current, error: readError } = await db
    .from('audio_recaps')
    .select('audio_revision')
    .eq('session_id', input.sessionId)
    .eq('status', 'draft')
    .single()
  if (readError) throw toDbError('Failed to read recap audio revision', readError)

  const currentRevision = Number((current as { audio_revision: number }).audio_revision)
  const { data, error } = await db
    .from('audio_recaps')
    .update({
      audio: '\\x' + input.audio.toString('hex'),
      audio_bytes: input.audio.byteLength,
      audio_revision: currentRevision + 1,
      audio_duration_seconds: input.durationSeconds,
      tts_provider: input.ttsProvider,
      tts_model: input.ttsModel,
      tts_voice: input.ttsVoice,
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', input.sessionId)
    .eq('status', 'draft')
    .eq('audio_revision', currentRevision)
    .select('id')
    .maybeSingle()

  if (error) throw toDbError('Failed to store recap audio', error)
  if (!data) throw new Error('The recap changed while audio was being generated; try again')
}

/** Guarded approval: only a draft WITH audio can be approved. */
export async function approveRecap(input: {
  sessionId: string
  userId: string
}): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('audio_recaps')
    .update({
      status: 'approved',
      approved_by: input.userId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', input.sessionId)
    .eq('status', 'draft')
    .not('audio_bytes', 'is', null)
    .select('id')

  if (error) throw toDbError('Failed to approve recap', error)
  return ((data as { id: string }[] | null) ?? []).length > 0
}

/**
 * Withdraw an approved recap back to moderator-only draft state. The current
 * script and audio are deliberately preserved so the moderator can compare,
 * edit, or re-synthesize before approving a replacement.
 */
export async function recallApprovedRecap(input: {
  sessionId: string
}): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('audio_recaps')
    .update({
      status: 'draft',
      approved_by: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', input.sessionId)
    .eq('status', 'approved')
    .select('id')

  if (error) throw toDbError('Failed to recall audio recap', error)
  return ((data as { id: string }[] | null) ?? []).length > 0
}

/**
 * The one blob read — used only by the streaming routes, after they have
 * authorized `findRecapForSession` metadata. A direct PostgREST GET selects
 * only `audio` and decodes its hex JSON as it arrives, so playback never
 * materializes the hex string or a decoded Buffer. The status and revision
 * filters pin the read to the exact audio that was authorized: any later
 * synthesis bumps the revision and any script edit clears the audio.
 * Resolves null when the row or its audio is gone (the caller's 404).
 */
export async function openRecapAudioStream(input: {
  sessionId: string
  status: 'draft' | 'approved'
  audioRevision: number
}): Promise<ReadableStream<Uint8Array> | null> {
  const base = process.env.SUPABASE_INTERNAL_URL || getPublicRuntimeConfig().supabaseUrl
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const query = new URLSearchParams({
    select: 'audio',
    session_id: `eq.${input.sessionId}`,
    status: `eq.${input.status}`,
    audio_revision: `eq.${input.audioRevision}`,
  })
  const response = await fetch(`${base}/rest/v1/audio_recaps?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/vnd.pgrst.object+json',
    },
    cache: 'no-store',
  })
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => null) as { code?: string } | null
    if (response.status === 406 && error?.code === 'PGRST116') return null
    throw toDbError(
      'Failed to fetch recap audio',
      error ?? new Error(`PostgREST responded ${response.status}`)
    )
  }

  try {
    return await decodeHexJsonValueBody(response.body)
  } catch (error) {
    throw toDbError('Failed to read recap audio', error)
  }
}

export interface ApprovedRecapDuration {
  session_id: string
  audio_duration_seconds: number
  /** Compared with the session's current documents (recapSourcesAreCurrent),
   *  exactly as the session page does before it shows the player. */
  source_digest: string | null
}

/**
 * Durations of the APPROVED recaps with audio among `sessionIds`, for the
 * newsletter's Audio Recap bar. Selects only the columns it needs (never the
 * audio). Service role: called after requireOpsManager +
 * requireDepartmentModerator in the newsletter generation action.
 */
export async function listApprovedRecapDurations(
  sessionIds: string[]
): Promise<ApprovedRecapDuration[]> {
  if (sessionIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('audio_recaps')
    .select('session_id, audio_duration_seconds, source_digest')
    .in('session_id', sessionIds)
    .eq('status', 'approved')
    .gt('audio_bytes', 0)
    .not('audio_duration_seconds', 'is', null)

  if (error) throw toDbError('Failed to list approved recap durations', error)
  return (data as ApprovedRecapDuration[] | null) ?? []
}
