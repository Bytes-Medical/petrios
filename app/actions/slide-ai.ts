'use server'

import { requireAuth, requireDepartmentModerator } from '@/lib/auth'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { authorDeck } from '@/lib/ai/slide-ai'
import type { Slide } from '@/lib/types'

/**
 * Generate a fresh deck from a topic ('generate') or revise the current deck
 * from an instruction ('edit'). Returns laid-out slides; the client decides
 * whether to replace or append, then autosaves via updateDeck.
 */
export async function generateSlides(input: {
  deckId: string
  mode: 'generate' | 'edit'
  prompt: string
  currentSlides?: Slide[]
  theme: string
}): Promise<{ slides: Slide[]; message: string }> {
  await requireAuth()

  const db = await createSupabaseServiceClient()
  const { data: deck, error } = await db
    .from('presentations')
    .select('id, department_id')
    .eq('id', input.deckId)
    .maybeSingle()
  if (error || !deck) throw new Error('Deck not found')
  await requireDepartmentModerator(deck.department_id)

  const prompt = (input.prompt || '').trim()
  if (!prompt) throw new Error('Enter a topic or instruction')

  const result = await authorDeck({
    mode: input.mode,
    prompt,
    currentSlides: input.currentSlides,
    theme: input.theme || 'default',
  })

  return { slides: result.slides, message: result.message }
}
