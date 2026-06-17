import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { ensureDeckForSession } from '@/app/actions/presentations'
import { SlideEditor } from '@/components/slides/SlideEditor'

export default async function SlidesPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  // ensureDeckForSession gates on requireDepartmentModerator and creates the
  // deck if missing. If the caller isn't allowed (or the session is gone), send
  // them back to the session page.
  let deck
  try {
    deck = await ensureDeckForSession(params.id)
  } catch {
    redirect(`/sessions/${params.id}`)
  }

  return (
    <SlideEditor
      deck={deck}
      backHref={`/sessions/${params.id}`}
      presentHref={`/sessions/${params.id}/slides/present`}
    />
  )
}
