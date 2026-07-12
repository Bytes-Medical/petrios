import Image from 'next/image'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { JoinByDeptCodeForm } from './JoinByDeptCodeForm'
import { Wordmark } from '@/components/Wordmark'

export default async function JoinByDeptCodePage() {
  const user = await getCurrentUser()

  const signedInEmail = user?.email ?? null
  const initialFirstName =
    (typeof user?.user_metadata?.first_name === 'string' ? user.user_metadata.first_name : '') || ''
  const initialLastName =
    (typeof user?.user_metadata?.last_name === 'string' ? user.user_metadata.last_name : '') || ''

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Wordmark size="lg" />
        </div>

        <h1 className="text-xl font-mono font-bold text-center mb-2">Join a Department</h1>
        <p className="text-center font-mono text-sm text-gray-600 mb-6">
          Enter the 6-digit department code given to you by your programme.
        </p>

        <JoinByDeptCodeForm
          signedInEmail={signedInEmail}
          initialFirstName={initialFirstName}
          initialLastName={initialLastName}
        />

        <div className="mt-6 text-center">
          <Link href="/login" className="font-mono text-sm underline">
            Already have access? Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
