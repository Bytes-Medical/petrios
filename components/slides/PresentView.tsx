'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SlideStage } from '@/components/slides/SlideStage'
import type { Slide } from '@/lib/types'

/** Fullscreen presenter view. Reuses the static SlideStage so what you present
 *  is pixel-identical to the editor canvas. */
export function PresentView({
  slides,
  theme,
  exitHref,
}: {
  slides: Slide[]
  theme: string
  exitHref: string
}) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [showNotes, setShowNotes] = useState(false)

  const clamped = Math.min(index, slides.length - 1)
  const slide = slides[clamped]

  useEffect(() => {
    function exit() {
      if (window.opener) window.close()
      else router.push(exitHref)
    }
    function onKey(e: KeyboardEvent) {
      if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) {
        e.preventDefault()
        setIndex((p) => Math.min(slides.length - 1, p + 1))
      } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        setIndex((p) => Math.max(0, p - 1))
      } else if (e.key === 'Home') setIndex(0)
      else if (e.key === 'End') setIndex(slides.length - 1)
      else if (e.key.toLowerCase() === 'n') setShowNotes((s) => !s)
      else if (e.key === 'Escape') exit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length, router, exitHref])

  function exit() {
    if (window.opener) window.close()
    else router.push(exitHref)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div style={{ width: 'min(100vw, 177.78vh)' }}>
        {slide && <SlideStage slide={slide} themeId={theme} interactive={false} />}
      </div>

      {showNotes && slide?.notes && (
        <div className="absolute bottom-14 left-1/2 max-h-40 w-[80vw] max-w-3xl -translate-x-1/2 overflow-auto border border-white/30 bg-black/85 p-3 font-mono text-sm text-white">
          {slide.notes}
        </div>
      )}

      <div className="absolute bottom-3 right-4 z-10 flex items-center gap-3 font-mono text-xs text-white/70">
        <button onClick={() => setIndex((p) => Math.max(0, p - 1))} className="hover:text-white">
          ‹ Prev
        </button>
        <span>
          {clamped + 1} / {slides.length}
        </span>
        <button
          onClick={() => setIndex((p) => Math.min(slides.length - 1, p + 1))}
          className="hover:text-white"
        >
          Next ›
        </button>
        <button onClick={() => setShowNotes((s) => !s)} className="hover:text-white">
          Notes (N)
        </button>
        <button onClick={exit} className="hover:text-white">
          Exit (Esc)
        </button>
      </div>
    </div>
  )
}
