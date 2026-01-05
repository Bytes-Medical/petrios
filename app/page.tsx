import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { Button } from '@/components/Button'
import { Typewriter } from '@/components/Typewriter'
import { Footer } from '@/components/Footer'
import Image from 'next/image'
import Link from 'next/link'

export default async function Home() {
  const user = await getCurrentUser()
  
  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4 py-12 sm:py-16">
        <div className="max-w-4xl w-full">
          <div className="border border-black p-8 sm:p-12 bg-white">
            <div className="text-center mb-8 sm:mb-12">
              <div className="flex justify-center mb-6">
                <Image
                  src="/assets/byte_logo.png"
                  alt="Byte Teaching Logo"
                  width={300}
                  height={200}
                  className="w-auto h-auto max-w-full"
                  priority
                />
              </div>
              <div className="h-8 sm:h-10 mb-6">
                <Typewriter
                  text="Teaching Management for NHS Trainees"
                  speed={30}
                  className="text-xl sm:text-2xl md:text-3xl font-mono text-gray-800"
                />
              </div>
            </div>

            <div className="space-y-6 sm:space-y-8 mb-8 sm:mb-12">
              <div>
                <h2 className="text-xl sm:text-2xl font-mono font-bold mb-3">What We Do</h2>
                <p className="font-mono text-sm sm:text-base text-gray-700 leading-relaxed">
                  Byte Teaching is a simple, powerful platform designed for NHS trainees to facilitate and encourage teaching. 
                  Schedule sessions, track attendance with multiple methods, collect feedback, and generate certificates—all in one place.
                </p>
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-mono font-bold mb-3">Key Features</h2>
                <ul className="font-mono text-sm sm:text-base text-gray-700 space-y-2">
                  <li>• <strong>Evidence-based attendance</strong> — Multiple check-in methods with full audit trail</li>
                  <li>• <strong>Group check-ins</strong> — QR codes and group codes for easy attendance tracking</li>
                  <li>• <strong>Feedback collection</strong> — Anonymous feedback with analytics</li>
                  <li>• <strong>Certificate generation</strong> — Automatic PDF certificates for teachers and attendees</li>
                  <li>• <strong>Simple interface</strong> — Clean, minimal design focused on usability</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-mono font-bold mb-3">Get Started</h2>
                <p className="font-mono text-sm sm:text-base text-gray-700 mb-6">
                  Create an account or sign in to start managing your teaching sessions.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link href="/login">
                    <Button className="w-full sm:w-auto px-8 py-3 text-base">
                      Sign In
                    </Button>
                  </Link>
                  <Link href="/signup">
                    <Button variant="secondary" className="w-full sm:w-auto px-8 py-3 text-base">
                      Sign Up
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
