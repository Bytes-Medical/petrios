export function Footer() {
  return (
    <footer className="border-t border-black mt-auto py-6 sm:py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center">
          <p className="font-mono text-sm text-gray-600">
            © {new Date().getFullYear()} Byte Teaching
            <span className="text-clay-600"> ▪ </span>Open source.
            <span className="text-clay-600"> ▪ </span>Self-hostable.
            <span className="text-clay-600"> ▪ </span>Yours.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-xs text-gray-500">
            <a
              href="https://github.com/Bytes-Medical/bytes-teaching"
              className="underline hover:text-clay-700"
            >
              GitHub
            </a>
            <a href="/contributors" className="underline hover:text-clay-700">
              Contributors
            </a>
            <a
              href="https://github.com/Bytes-Medical/bytes-teaching/blob/main/ROADMAP.md"
              className="underline hover:text-clay-700"
            >
              Roadmap
            </a>
            <a
              href="https://github.com/Bytes-Medical/bytes-teaching/blob/main/docs/api.md"
              className="underline hover:text-clay-700"
            >
              API
            </a>
            <a href="/privacy" className="underline hover:text-clay-700">
              Privacy
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
