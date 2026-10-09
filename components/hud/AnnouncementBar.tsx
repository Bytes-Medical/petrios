import Link from 'next/link'
import { clsx } from 'clsx'
import { formatNewsDate, type NewsEntry } from '@/lib/news-data'
import { StatusChip } from './StatusChip'
import s from './hud.module.css'

/**
 * The newest /news entry as one link: tag chip, title (wraps on phones, never
 * truncates) and the issue date. No arrow; the date says what it is.
 */
export function AnnouncementBar({ entry, className }: { entry: NewsEntry; className?: string }) {
  return (
    <Link href={`/news#${entry.slug}`} className={clsx(s.announce, className)}>
      <StatusChip kind="info">{entry.tag}</StatusChip>
      <span className={s.announceTitle}>{entry.title}</span>
      <time dateTime={entry.date} className={s.announceDate}>
        {formatNewsDate(entry.date)}
      </time>
    </Link>
  )
}
