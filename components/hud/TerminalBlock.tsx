import { Fragment } from 'react'
import { clsx } from 'clsx'
import s from './hud.module.css'

export interface TerminalLine {
  command: string
  comment?: string
}

/**
 * A static shell transcript: `$` prompts (aria-hidden and unselectable, so
 * copying yields runnable commands), commands in term ink and aligned
 * `#` comments in term dim. The <pre> scrolls sideways on phones, so it is
 * focusable for keyboard scrolling.
 */
export function TerminalBlock({
  lines,
  caption = 'Terminal',
  className,
}: {
  lines: ReadonlyArray<TerminalLine>
  caption?: string
  className?: string
}) {
  const commentColumn = Math.max(0, ...lines.filter((line) => line.comment).map((line) => line.command.length)) + 3
  return (
    <figure className={clsx(s.terminal, className)}>
      <figcaption className={s.caption}>{caption}</figcaption>
      <pre tabIndex={0}>
        {lines.map((line, index) => (
          <Fragment key={index}>
            {index > 0 ? '\n' : null}
            <span className={clsx(s.termPrompt, 'select-none')} aria-hidden="true">
              {'$ '}
            </span>
            {line.comment ? (
              <>
                {line.command.padEnd(commentColumn)}
                <span className={s.termDim}>{`# ${line.comment}`}</span>
              </>
            ) : (
              line.command
            )}
          </Fragment>
        ))}
      </pre>
    </figure>
  )
}
