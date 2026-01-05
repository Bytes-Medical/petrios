'use server'

import { createSupabaseClient } from '@/lib/supabase/server'
import { requireAuth, requireOrg, requireDepartmentModerator } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export interface FeedbackData {
  rating: number
  comment?: string
  isAnonymous?: boolean
}

export async function submitFeedback(sessionId: string, feedback: FeedbackData) {
  const supabase = await createSupabaseClient()

  // Get session to verify it exists and is published (public access allowed)
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id, org_id, status')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    throw new Error('Session not found')
  }

  if (session.status !== 'PUBLISHED') {
    throw new Error('Feedback can only be submitted for published sessions')
  }

  const orgId = session.org_id

  // Get current user (optional - for anonymous feedback)
  let userId: string | null = null
  if (!feedback.isAnonymous) {
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id || null
  }

  const { data, error } = await supabase
    .from('session_feedback')
    .insert({
      org_id: orgId,
      session_id: sessionId,
      user_id: userId,
      rating: feedback.rating,
      comment: feedback.comment || null,
      is_anonymous: feedback.isAnonymous ?? true,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to submit feedback: ${error.message}`)
  }

  // Create FEEDBACK evidence if valid for attendance
  // Only if user is authenticated and is a department member (balanced mode)
  if (userId) {
    try {
      // Check if user is a department member
      const { data: member } = await supabase
        .from('department_members')
        .select('id')
        .eq('department_id', session.department_id)
        .eq('user_id', userId)
        .single()

      if (member) {
        // User is a department member, create evidence
        const { addEvidence } = await import('./attendance-evidence')
        await addEvidence(sessionId, 'FEEDBACK', {
          userId,
          metadata: {
            feedback_id: data.id,
          },
        })
      }
    } catch (err) {
      // Evidence creation failed, but feedback was saved - log and continue
      console.error('Failed to create feedback evidence:', err)
    }
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return data
}

export async function getSessionFeedback(sessionId: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  // Get session to check permissions
  const { data: session } = await supabase
    .from('sessions')
    .select('department_id')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  // Only moderators can view feedback
  await requireDepartmentModerator(session.department_id)

  const { data, error } = await supabase
    .from('session_feedback')
    .select('*')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch feedback: ${error.message}`)
  }

  return data || []
}

export async function getSessionFeedbackStats(sessionId: string) {
  const feedback = await getSessionFeedback(sessionId)

  const total = feedback.length
  const ratings = feedback.map(f => f.rating).filter(Boolean) as number[]
  const averageRating = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    : 0

  const ratingDistribution = {
    1: ratings.filter(r => r === 1).length,
    2: ratings.filter(r => r === 2).length,
    3: ratings.filter(r => r === 3).length,
    4: ratings.filter(r => r === 4).length,
    5: ratings.filter(r => r === 5).length,
  }

  const comments = feedback.filter(f => f.comment && f.comment.trim().length > 0)

  return {
    total,
    averageRating: Math.round(averageRating * 10) / 10,
    ratingDistribution,
    commentsCount: comments.length,
    comments,
  }
}
