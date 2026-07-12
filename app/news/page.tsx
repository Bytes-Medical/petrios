import { PublicNav } from '@/components/PublicNav'
import { Footer } from '@/components/Footer'
import { Badge } from '@/components/Badge'
import { NEWS } from '@/lib/news-data'

export const metadata = {
  title: 'News',
  description:
    'Announcements from the Byte Teaching project: releases, conferences, and community news.',
  alternates: { canonical: '/news' },
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** PUBLIC news page (listed in proxy.ts). Entries live in lib/news-data.ts. */
export default function NewsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav current="news" />
      <main className="flex-1 px-4 py-10 sm:py-14 bg-dotgrid">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <h1 className="font-mono text-3xl font-bold sm:text-4xl">News</h1>
            <p className="mx-auto mt-3 max-w-2xl font-mono text-sm text-gray-700">
              Announcements from the project — releases, conferences, and
              community milestones.
            </p>
          </div>

          <div className="space-y-6">
            {NEWS.map((entry) => (
              <article
                key={entry.slug}
                id={entry.slug}
                className="border border-black border-t-4 border-t-clay-600 bg-white p-6 shadow-[8px_8px_0_rgba(31,29,26,0.08)] sm:p-8"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="clay">{entry.tag}</Badge>
                  <time dateTime={entry.date} className="font-mono text-xs text-gray-500">
                    {formatDate(entry.date)}
                  </time>
                </div>
                <h2 className="mt-3 font-mono text-xl font-bold sm:text-2xl">{entry.title}</h2>
                <div className="mt-3 space-y-3">
                  {entry.body.map((paragraph, i) => (
                    <p key={i} className="font-mono text-sm text-gray-700 leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
                </div>
                {entry.link && (
                  <p className="mt-4 font-mono text-sm">
                    <a href={entry.link.href} className="underline hover:text-clay-700">
                      {entry.link.label} →
                    </a>
                  </p>
                )}
              </article>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
