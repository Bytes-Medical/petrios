import Link from 'next/link'
import { Footer } from '@/components/Footer'

export function ComplianceSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-8" aria-labelledby={`section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <h2
        id={`section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        className="mb-3 font-mono text-lg font-bold"
      >
        {title}
      </h2>
      <div className="space-y-3 font-mono text-sm leading-relaxed text-gray-700">{children}</div>
    </section>
  )
}

export function MissingDisclosure({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-semibold text-clay-700">
      Not declared by this deployment: {children}
    </span>
  )
}

export function CompliancePage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 px-4 py-10 sm:px-6">
        <article className="mx-auto max-w-3xl">
          <Link href="/" className="font-mono text-sm underline hover:text-clay-700">
            ← Home
          </Link>
          <h1 className="mt-4 font-mono text-2xl font-bold sm:text-3xl">{title}</h1>
          <p className="mt-3 max-w-2xl font-mono text-sm leading-relaxed text-gray-600">
            {description}
          </p>
          <p className="mt-2 font-mono text-xs text-gray-500">Last updated: 18 July 2026</p>
          <div className="mt-8">{children}</div>
        </article>
      </main>
      <Footer />
    </div>
  )
}
