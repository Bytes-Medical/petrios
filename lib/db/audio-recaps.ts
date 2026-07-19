import { getServiceDb } from './client'
import { toDbError } from './errors'
import type {
  AudioRecapResearchSource,
  AudioRecapSourceDocument,
} from '@/lib/audio-recap-types'

/**
 * Audio recaps DAL (audio_recaps, deny-all RLS). Service role justification:
 * mutations are requireDepartmentModerator-gated in
 * app/actions/audio-recaps.ts; the attendee read path is the org-scoped
 * streaming route /api/sessions/[id]/recap-audio.
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

/** The one blob read — used only by the streaming route. */
export async function findRecapAudio(
  sessionId: string
): Promise<{
  audio: Buffer
  status: 'draft' | 'approved'
  source_digest: string | null
} | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('audio_recaps')
    .select('audio, status, source_digest')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch recap audio', error)
  const row = data as {
    audio: string | null
    status: 'draft' | 'approved'
    source_digest: string | null
  } | null
  if (!row?.audio) return null
  const hex = row.audio.startsWith('\\x') ? row.audio.slice(2) : row.audio
  return {
    audio: Buffer.from(hex, 'hex'),
    status: row.status,
    source_digest: row.source_digest,
  }
}
