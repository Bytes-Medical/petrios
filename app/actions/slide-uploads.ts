'use server'

import { requireAuth, requireDepartmentModerator } from '@/lib/auth'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

const BUCKET = 'slide-images'
const MAX_BYTES = 8 * 1024 * 1024

/** Upload an image for a deck to Supabase Storage; returns its public URL.
 *  Gated by department-moderator on the owning deck. */
export async function uploadSlideImage(formData: FormData): Promise<{ url: string }> {
  await requireAuth()
  const deckId = String(formData.get('deckId') || '')
  const file = formData.get('file')

  if (!(file instanceof File)) throw new Error('No file provided')
  if (!file.type.startsWith('image/')) throw new Error('Only image files are allowed')
  if (file.size > MAX_BYTES) throw new Error('Image too large (max 8MB)')

  const db = await createSupabaseServiceClient()
  const { data: deck, error } = await db
    .from('presentations')
    .select('id, org_id, department_id')
    .eq('id', deckId)
    .maybeSingle()
  if (error || !deck) throw new Error('Deck not found')
  await requireDepartmentModerator(deck.department_id)

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${deck.org_id}/${deckId}/${crypto.randomUUID()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())

  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
  return { url: pub.publicUrl }
}
