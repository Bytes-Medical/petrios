export function Footer() {
  return (
    <footer className="border-t border-black mt-auto py-6 sm:py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center">
          <p className="font-mono text-sm text-gray-600">
            © {new Date().getFullYear()} Petrios
            <span className="text-clay-600"> ▪ </span>Open source.
            <span className="text-clay-600"> ▪ </span>Self-hostable.
            <span className="text-clay-600"> ▪ </span>Yours.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-xs text-gray-500">
            <a
              href="https://github.com/Bytes-Medical/petrios"
              className="underline hover:text-clay-700"
            >
              GitHub
            </a>
            <a href="/features" className="underline hover:text-clay-700">
              Features
            </a>
            <a href="/news" className="underline hover:text-clay-700">
              News
            </a>
            <a href="/open-source" className="underline hover:text-clay-700">
              Open Source
            </a>
            <a href="/contributors" className="underline hover:text-clay-700">
              Contributors
            </a>
            <a
              href="https://github.com/Bytes-Medical/petrios/blob/main/ROADMAP.md"
              className="underline hover:text-clay-700"
            >
              Roadmap
            </a>
            <a
              href="https://github.com/Bytes-Medical/petrios/blob/main/docs/api.md"
              className="underline hover:text-clay-700"
            >
              API
            </a>
            <a href="/privacy" className="underline hover:text-clay-700">
              Privacy
            </a>
            <a href="/privacy/choices" className="underline hover:text-clay-700">
              Your privacy choices
            </a>
            <a href="/subprocessors" className="underline hover:text-clay-700">
              Subprocessors
            </a>
            <a href="/data-processing-agreement" className="underline hover:text-clay-700">
              DPA
            </a>
          </div>
          <p className="mt-2 font-mono text-xs text-gray-500">
            Licensed under{' '}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.en.html"
              className="underline hover:text-clay-700"
            >
              AGPL-3.0
            </a>{' '}
            (code) and{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              className="underline hover:text-clay-700"
            >
              CC-BY-SA 4.0
            </a>{' '}
            (docs &amp; specifications).
          </p>
        </div>
      </div>
    </footer>
  )
}
