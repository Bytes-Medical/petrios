import Image from 'next/image'
import Link from 'next/link'
import { PasswordlessLoginForm } from '@/components/PasswordlessLoginForm'

export default function TraineeLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md border border-black bg-white p-6 sm:p-8">
        <div className="flex justify-center mb-6">
          <Image
            src="/assets/byte_logo.png"
            alt="Byte Teaching Logo"
            width={200}
            height={133}
            className="w-auto h-auto max-w-full"
            priority
          />
        </div>

        <h1 className="text-lg sm:text-xl font-mono font-bold text-center">Trainee Sign-In</h1>
        <p className="mt-2 mb-6 text-center font-mono text-sm text-gray-600">
          Use the email address attached to your department invite. We&apos;ll send you a secure sign-in link.
        </p>

        <PasswordlessLoginForm />

        <div className="mt-6 border-t border-black pt-6 space-y-4">
          <div>
            <p className="font-mono text-sm text-gray-600">
              New trainee? Join with your department code.
            </p>
            <Link
              href="/join/dept"
              className="mt-3 inline-block border border-black bg-black px-4 py-3 font-mono text-sm text-white hover:bg-gray-800"
            >
              Join a Department
            </Link>
          </div>
          <div>
            <p className="font-mono text-sm text-gray-600">
              Moderator or admin account?
            </p>
            <Link
              href="/login"
              className="mt-3 inline-block border border-black bg-white px-4 py-3 font-mono text-sm text-black hover:bg-gray-50"
            >
              Go to Staff Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
