import s from './hud.module.css'

export interface Contrast {
  usual: string
  usualDetail: string
  better: string
  betterDetail: string
}

const USUAL = 'The usual way'
const BETTER = 'The Petrios way'

/**
 * Paired contrasts, one grid row per pair so the two sides always line up.
 * The sides differ by shape (dashed sunk cell vs solid cell with a clay inset
 * rule) and by label, never by colour alone. Each cell keeps its own label:
 * visible when the pair stacks below 640px, screen-reader-only beside the
 * aria-hidden column header above it.
 */
export function CompareRows({ rows, className }: { rows: ReadonlyArray<Contrast>; className?: string }) {
  return (
    <div className={className}>
      <div className={s.compareHead} aria-hidden="true">
        <span>{USUAL}</span>
        <span>{BETTER}</span>
      </div>
      <ul className={s.pairs}>
        {rows.map((row) => (
          <li key={row.usual} className={s.pair}>
            <div className={s.usual}>
              <span className={s.lbl}>{USUAL}</span>
              <strong>{row.usual}</strong>
              <p>{row.usualDetail}</p>
            </div>
            <span className={s.connector} aria-hidden="true">
              <svg viewBox="0 0 9 6" focusable="false">
                <path d="M0 3.5h8" shapeRendering="crispEdges" />
                <path d="M6 1.5l2 2-2 2" strokeWidth="1.25" />
              </svg>
            </span>
            <div className={s.better}>
              <span className={s.lbl}>{BETTER}</span>
              <strong>{row.better}</strong>
              <p>{row.betterDetail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
