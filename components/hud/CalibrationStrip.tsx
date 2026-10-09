import { clsx } from 'clsx'
import { Typewriter } from '@/components/Typewriter'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'
import s from './hud.module.css'

/**
 * The signature: the landing h1 drawn on ECG paper. A 1 mV calibration pulse
 * (10 x 10 mm at 50 mm/s and 10 mm/mV) becomes the wordmark's ■, followed by
 * one to-scale P-QRS-T complex (QRS only below a 480px hero container) and a
 * lead-out ending in the phosphor write-head. The caption describes the
 * drawing's scale and nothing else. Place it first inside
 * <Panel as="section" pad="none" aria-labelledby="hero-title" className={hero}>.
 *
 * The trace segments are flex items, which some accessible-name algorithms
 * pad with spaces, so the h1 also carries the exact name as aria-label. The
 * sr-only colon keeps textContent identical for no-JS and copy.
 */
export function CalibrationStrip({ className }: { className?: string }) {
  return (
    <div className={clsx(s.strip, className)} data-part="strip">
      <h1 id="hero-title" className={s.heroTitle} aria-label={`${SITE_NAME}: ${SITE_TAGLINE}`}>
        <span className={s.trace} data-part="trace">
          <span className={clsx(s.seg, s.segIn)} aria-hidden="true" data-part="trace-seg" />
          <svg className={s.pulse} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <rect width="10" height="10" />
            <path d="M0 10V0H10V10" />
          </svg>
          <span className={s.word}>{SITE_NAME}</span>
          <svg className={clsx(s.cx, s.cxFull)} viewBox="0 0 26.5 10" aria-hidden="true" focusable="false">
            <path d="M0 10Q2.5 7 5 10L9 10L10 11L11.25 0L12.5 13L13.5 10L18.5 10Q22.5 4 26.5 10" />
          </svg>
          <svg className={clsx(s.cx, s.cxQrs)} viewBox="0 0 4.5 10" aria-hidden="true" focusable="false">
            <path d="M0 10L1 11L2.25 0L3.5 13L4.5 10" />
          </svg>
          <span className={clsx(s.seg, s.segOut)} aria-hidden="true" data-part="trace-out">
            <span className={s.head} data-part="write-head" />
          </span>
        </span>
        <span className={s.srOnly}>: </span>
        <Typewriter text={SITE_TAGLINE} className={s.tagline} />
      </h1>
      <p className={s.cal} aria-hidden="true">
        <span>50 mm/s</span>
        <span>10 mm/mV</span>
      </p>
    </div>
  )
}
