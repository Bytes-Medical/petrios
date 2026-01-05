export function Footer() {
  return (
    <footer className="border-t border-black mt-auto py-6 sm:py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center">
          <p className="font-mono text-sm text-gray-600">
            © {new Date().getFullYear()} Byte Teaching. Simple. Effective. Reliable.
          </p>
        </div>
      </div>
    </footer>
  )
}
