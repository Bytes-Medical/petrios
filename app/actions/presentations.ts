'use server'

import { revalidatePath } from 'next/cache'
import DOMPurify from 'isomorphic-dompurify'
import { requireAuth, requireDepartmentModerator } from '@/lib/auth'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import type { Presentation, Slide } from '@/lib/types'

/** Sanitise rich-text HTML before persisting — slides are presented/shared, so
 *  this is the authoritative XSS gate (all writes flow through updateDeck). */
function sanitizeSlides(slides: Slide[]): Slide[] {
  return slides.map((s) => ({
    ...s,
    blocks: s.blocks.map((b) =>
      b.html ? { ...b, html: DOMPurify.sanitize(b.html, { USE_PROFILES: { html: true } }) } : b
    ),
  }))
}

interface SessionScope {
  id: string
  org_id: string
  department_id: string
  title: string
}

async function loadSessionScope(sessionId: string): Promise<SessionScope> {
  const db = await createSupabaseServiceClient()
  const { data, error } = await db
    .from('sessions')
    .select('id, org_id, department_id, title')
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load session: ${error.message}`)
  if (!data) throw new Error('Session not found')
  return data as SessionScope
}

async function loadDeck(deckId: string): Promise<Presentation> {
  const db = await createSupabaseServiceClient()
  const { data, error } = await db
    .from('presentations')
    .select('*')
    .eq('id', deckId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load deck: ${error.message}`)
  if (!data) throw new Error('Deck not found')
  return data as Presentation
}

/** The deck attached to a session (most recent), or null. Editor-gated. */
export async function getDeckForSession(sessionId: string): Promise<Presentation | null> {
  await requireAuth()
  const scope = await loadSessionScope(sessionId)
  await requireDepartmentModerator(scope.department_id)

  const db = await createSupabaseServiceClient()
  const { data, error } = await db
    .from('presentations')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load deck: ${error.message}`)
  return (data as Presentation | null) ?? null
}

/** Get-or-create the deck for a session so the editor always has one to open. */
export async function ensureDeckForSession(sessionId: string): Promise<Presentation> {
  const userId = await requireAuth()
  const scope = await loadSessionScope(sessionId)
  await requireDepartmentModerator(scope.department_id)

  const existing = await getDeckForSession(sessionId)
  if (existing) return existing

  const db = await createSupabaseServiceClient()
  const { data, error } = await db
    .from('presentations')
    .insert({
      id: crypto.randomUUID(),
      org_id: scope.org_id,
      department_id: scope.department_id,
      session_id: sessionId,
      title: scope.title || 'Untitled deck',
      slides: [],
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) throw new Error(`Failed to create deck: ${error.message}`)

  revalidatePath(`/sessions/${sessionId}/slides`)
  return data as Presentation
}

export async function getDeck(deckId: string): Promise<Presentation> {
  await requireAuth()
  const deck = await loadDeck(deckId)
  await requireDepartmentModerator(deck.department_id)
  return deck
}

/** Autosave the deck (slides and/or title/theme). */
export async function updateDeck(
  deckId: string,
  updates: { slides?: Slide[]; title?: string; theme?: string }
): Promise<{ updated_at: string }> {
  await requireAuth()
  const deck = await loadDeck(deckId)
  await requireDepartmentModerator(deck.department_id)

  const updatedAt = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: updatedAt }
  if (updates.slides !== undefined) patch.slides = sanitizeSlides(updates.slides)
  if (updates.title !== undefined) patch.title = updates.title
  if (updates.theme !== undefined) patch.theme = updates.theme

  const db = await createSupabaseServiceClient()
  const { error } = await db.from('presentations').update(patch).eq('id', deckId)
  if (error) throw new Error(`Failed to save deck: ${error.message}`)

  if (deck.session_id) {
    revalidatePath(`/sessions/${deck.session_id}/slides`)
  }
  return { updated_at: updatedAt }
}
