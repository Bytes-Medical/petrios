import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getDeckForSession } from '@/app/actions/presentations'
import { PresentView } from '@/components/slides/PresentView'

export default async function PresentPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  let deck
  try {
    deck = await getDeckForSession(params.id)
  } catch {
    redirect(`/sessions/${params.id}`)
  }
  if (!deck || !deck.slides?.length) {
    redirect(`/sessions/${params.id}/slides`)
  }

  return (
    <PresentView
      slides={deck.slides}
      theme={deck.theme || 'default'}
      exitHref={`/sessions/${params.id}/slides`}
    />
  )
}
