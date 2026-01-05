import { redirect } from 'next/navigation'
import { createSupabaseClient } from '@/lib/supabase/server'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { FeedbackForm } from '@/components/FeedbackForm'

export default async function SessionFeedbackPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createSupabaseClient()

  // Get session - allow public access for feedback
  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !session || session.status !== 'PUBLISHED') {
    redirect('/')
  }

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2 break-words">{session.title}</h1>
          <p className="font-mono text-sm text-gray-600">Session Feedback</p>
        </div>

        <Card>
          <FeedbackForm sessionId={params.id} sessionTitle={session.title} />
        </Card>
      </div>
    </div>
  )
}
