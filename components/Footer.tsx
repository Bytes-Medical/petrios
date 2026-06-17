export function Footer() {
  return (
    <footer className="border-t border-black mt-auto py-6 sm:py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center">
          <p className="font-mono text-sm text-gray-600">
            © {new Date().getFullYear()} Byte Teaching
            <span className="text-clay-600"> ▪ </span>Simple.
            <span className="text-clay-600"> ▪ </span>Effective.
            <span className="text-clay-600"> ▪ </span>Reliable.
          </p>
          <a href="/privacy" className="mt-2 inline-block font-mono text-xs text-gray-500 underline hover:text-clay-700">
            Privacy Policy
          </a>
        </div>
      </div>
    </footer>
  )
}
