import { clsx } from 'clsx'
import { HudShell } from '@/components/hud/HudShell'
import { HudLink } from '@/components/hud/HudLink'
import { PageHeader } from '@/components/hud/PageHeader'
import { Panel } from '@/components/hud/Panel'
import { StatusChip } from '@/components/hud/StatusChip'
import s from '@/components/hud/hud.module.css'
import { NEWS, formatNewsDate } from '@/lib/news-data'

export const metadata = {
  title: 'News',
  description:
    'Announcements from the Petrios project: releases, conferences, and community news.',
  alternates: { canonical: '/news' },
}

/** PUBLIC news page (listed in proxy.ts). Entries live in lib/news-data.ts. */
export default function NewsPage() {
  return (
    <HudShell current="news" width="prose">
      <PageHeader
        title="News"
        lede="Announcements from the project — releases, conferences, and community milestones."
      />

      {NEWS.map((entry) => (
        <Panel key={entry.slug} as="article" id={entry.slug} aria-labelledby={`${entry.slug}-title`}>
          <div className={s.newsMeta}>
            <StatusChip kind="info">{entry.tag}</StatusChip>
            <time dateTime={entry.date} className={s.date}>
              {formatNewsDate(entry.date)}
            </time>
          </div>
          <h2 id={`${entry.slug}-title`} className={clsx(s.panelTitle, 'mt-3')}>
            {entry.title}
          </h2>
          <div className="mt-3 space-y-3">
            {entry.body.map((paragraph, i) => (
              <p key={i} className={s.body}>
                {paragraph}
              </p>
            ))}
          </div>
          {entry.link ? (
            <p className={clsx(s.body, 'mt-4')}>
              <HudLink href={entry.link.href}>{entry.link.label}</HudLink>
            </p>
          ) : null}
        </Panel>
      ))}
    </HudShell>
  )
}
