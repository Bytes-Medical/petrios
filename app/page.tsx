import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { Button } from '@/components/Button'
import { Typewriter } from '@/components/Typewriter'
import { Footer } from '@/components/Footer'
import Image from 'next/image'
import Link from 'next/link'
import { INDIVIDUAL_SIGNUP_ENABLED } from '@/lib/flags'

export default async function Home() {
  const user = await getCurrentUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4 py-12 sm:py-16 bg-dotgrid">
        <div className="max-w-4xl w-full">
          <div className="border border-black border-t-4 border-t-clay-600 p-8 sm:p-12 bg-white shadow-[8px_8px_0_rgba(31,29,26,0.08)]">
            {/* Hero */}
            <div className="text-center mb-8 sm:mb-12">
              <div className="flex justify-center mb-6">
                <Image
                  src="/assets/byte_logo.png"
                  alt="Byte Teaching Logo"
                  width={300}
                  height={200}
                  className="w-auto h-auto max-w-full mix-blend-multiply"
                  priority
                />
              </div>
              <div className="h-8 sm:h-10 mb-6">
                <Typewriter
                  text="Teaching management for NHS educators"
                  speed={30}
                  className="text-xl sm:text-2xl md:text-3xl font-mono text-gray-800"
                />
              </div>
              <p className="font-mono text-sm sm:text-base text-gray-700 max-w-2xl mx-auto leading-relaxed">
                Schedule sessions, track attendance, collect feedback, and issue
                certificates {INDIVIDUAL_SIGNUP_ENABLED
                  ? '— whether you teach on your own or run a whole programme.'
                  : 'across your trust or teaching programme.'}
              </p>
            </div>

            {/* Sign-in paths */}
            <div
              className={`grid grid-cols-1 gap-4 mb-8 sm:gap-6 sm:mb-12 ${
                INDIVIDUAL_SIGNUP_ENABLED ? 'sm:grid-cols-2' : 'max-w-md mx-auto'
              }`}
            >
              {/* Individual */}
              {INDIVIDUAL_SIGNUP_ENABLED && (
                <div className="flex flex-col border border-black p-6 bg-white transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_0_#1F1D1A]">
                  <span className="mb-2 font-mono text-xs uppercase tracking-wide text-clay-700">
                    Individual
                  </span>
                  <h2 className="mb-3 text-lg sm:text-xl font-mono font-bold">
                    Teach on your own
                  </h2>
                  <p className="mb-6 flex-1 font-mono text-sm text-gray-700 leading-relaxed">
                    Run your own sessions in minutes. QR attendance, automatic
                    certificates, and feedback reports — no organisation required. We set
                    up your personal teaching space the moment you sign in.
                  </p>
                  <Link href="/login/individual">
                    <Button className="w-full">Start teaching →</Button>
                  </Link>
                </div>
              )}

              {/* Organisation */}
              <div className="flex flex-col border border-black p-6 bg-white transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_0_#1F1D1A]">
                <span className="mb-2 font-mono text-xs uppercase tracking-wide text-clay-700">
                  Organisation
                </span>
                <h2 className="mb-3 text-lg sm:text-xl font-mono font-bold">
                  For trusts &amp; programmes
                </h2>
                <p className="mb-6 flex-1 font-mono text-sm text-gray-700 leading-relaxed">
                  Coordinate teaching across departments with shared scheduling, audit
                  reports, member management, and oversight. Join your programme with
                  the code your teaching lead gave you.
                </p>
                <div className="flex flex-col gap-3">
                  <Link href="/login/organisation">
                    <Button className="w-full">Sign in</Button>
                  </Link>
                  <Link href="/join/dept">
                    <Button variant="secondary" className="w-full">
                      Join with a department code
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="border-t border-gray-200 pt-6 sm:pt-8">
              <h2 className="mb-3 text-base sm:text-lg font-mono font-bold">
                Everything in one place
              </h2>
              <ul className="font-mono text-sm text-gray-700 space-y-2">
                <li><span className="text-clay-600">▸</span> <strong>Evidence-based attendance</strong> — multiple check-in methods with a full audit trail</li>
                <li><span className="text-clay-600">▸</span> <strong>QR &amp; group codes</strong> — fast, low-friction attendance tracking</li>
                <li><span className="text-clay-600">▸</span> <strong>Anonymous feedback</strong> — collected and analysed automatically</li>
                <li><span className="text-clay-600">▸</span> <strong>Certificate generation</strong> — automatic PDFs for teachers and attendees</li>
                <li><span className="text-clay-600">▸</span> <strong>Simple interface</strong> — clean, minimal design focused on usability</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
