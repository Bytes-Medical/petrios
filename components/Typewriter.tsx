import { Fragment, type CSSProperties } from 'react'
import { clsx } from 'clsx'
import s from '@/components/hud/hud.module.css'
import { chunkForTyping } from '@/lib/typewriter'

/**
 * CSS-only typewriter (server component). The full text is in the server
 * HTML as real text nodes, grouped into nowrap chunks that are revealed one
 * monospace advance per step with clip-path, so the accessibility tree,
 * find-in-page, selection and textContent always hold the whole string and
 * the layout never shifts. A caret rides the reveal edge; the block cursor
 * snaps on at the end, blinks 4 times (WCAG 2.2.2) and stays solid. Under
 * reduced motion, or without CSS animation support, the final state shows.
 */
export function Typewriter({
  text,
  className,
  startMs = 350,
  stepMs = 27,
}: {
  text: string
  className?: string
  startMs?: number
  stepMs?: number
}) {
  const chunks = chunkForTyping(text)
  if (!chunks) {
    return (
      <span className={clsx(s.tw, className)}>
        {text}
        <span className={s.twCursor} aria-hidden="true" data-part="cursor" />
      </span>
    )
  }
  const timing = {
    '--tw-start': `${startMs}ms`,
    '--tw-step': `${stepMs}ms`,
    '--tw-total': text.length,
  } as CSSProperties
  return (
    <span className={clsx(s.tw, s.twAnimated, className)} style={timing}>
      {chunks.map((chunk, index) => (
        <Fragment key={chunk.offset}>
          {index > 0 ? ' ' : null}
          <span
            className={s.twChunk}
            style={{ '--n': chunk.text.length, '--o': chunk.offset } as CSSProperties}
            data-part="tw-chunk"
          >
            <span className={s.twText} data-part="tw-text">
              {chunk.text}
            </span>
            {index === chunks.length - 1 ? (
              <span className={s.twCursor} aria-hidden="true" data-part="cursor" />
            ) : null}
          </span>
        </Fragment>
      ))}
    </span>
  )
}
