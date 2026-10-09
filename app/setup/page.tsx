import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getInstallationState } from '@/lib/db/installation'
import { SetupForm } from './SetupForm'

export const metadata = { title: 'Set up Petrios', robots: { index: false, follow: false } }
export default async function SetupPage() {
  if (process.env.SELF_HOSTED_SETUP !== 'true' || !process.env.SETUP_TOKEN) notFound()
  const state = await getInstallationState()
  return <main className="mx-auto w-full max-w-xl px-6 py-16"><Link href="/" className="text-sm font-semibold">Petrios</Link><h1 className="mb-4 mt-8 text-3xl font-semibold">Set up your teaching platform</h1><p className="mb-8 text-gray-600">Create your administrator account and first teaching department.</p>{state.blocked || state.completed_at ? <p>Setup is closed for this installation. <Link className="underline" href="/login">Sign in</Link></p> : <SetupForm />}</main>
}
