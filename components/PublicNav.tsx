import Link from 'next/link'
import { Wordmark } from './Wordmark'

/**
 * Navigation for the public (signed-out) site: landing, features,
 * open-source, contributors. The signed-in app uses NavShell/Nav instead.
 */
export function PublicNav({ current }: { current?: 'features' | 'open-source' | 'contributors' | 'news' }) {
  const linkClass = (key: string) =>
    current === key
      ? 'underline underline-offset-4 decoration-clay-600 decoration-2'
      : 'hover:underline hover:underline-offset-4'

  return (
    <nav className="border-b border-black bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center">
          <Wordmark />
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm">
          <Link href="/features" className={linkClass('features')}>
            Features
          </Link>
          <Link href="/news" className={linkClass('news')}>
            News
          </Link>
          <Link href="/open-source" className={linkClass('open-source')}>
            Open Source
          </Link>
          <Link href="/contributors" className={linkClass('contributors')}>
            Contributors
          </Link>
          <a
            href="https://github.com/Bytes-Medical/petrios"
            className="hover:underline hover:underline-offset-4"
          >
            GitHub ↗
          </a>
          <Link
            href="/login"
            className="border border-black bg-black px-3 py-1.5 text-white hover:bg-gray-800"
          >
            Sign in
          </Link>
        </div>
      </div>
    </nav>
  )
}
