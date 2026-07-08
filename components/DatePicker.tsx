'use client'

import { useEffect, useRef, useState } from 'react'
import {
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  formatDayKey,
  monthLabel,
  todayKey,
} from '@/lib/date-picker'
import { cn } from '@/lib/utils'

interface DatePickerProps {
  /** 'YYYY-MM-DD' or '' */
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
}

// Same field token as DateTimePicker so the trigger lines up with selects.
const fieldStyles =
  'h-10 px-3 border border-black font-mono text-sm bg-white focus:outline-none focus:border-clay-600 focus:ring-1 focus:ring-clay-600'

/** Themed replacement for the native date input: a monospace popover calendar. */
export function DatePicker({ value, onChange, ariaLabel, className }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const initial = value ? new Date(value) : new Date()
  const [view, setView] = useState({
    year: initial.getFullYear(),
    monthIndex: initial.getMonth(),
  })

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const weeks = buildMonthGrid(view.year, view.monthIndex)
  const today = todayKey()

  const openCalendar = () => {
    if (value) {
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) {
        setView({ year: d.getFullYear(), monthIndex: d.getMonth() })
      }
    }
    setOpen((o) => !o)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={openCalendar}
        aria-label={ariaLabel ?? 'Choose date'}
        aria-expanded={open}
        className={cn(
          fieldStyles,
          'w-full text-left flex items-center justify-between gap-2',
          !value && 'text-gray-400'
        )}
      >
        <span className="truncate">{value ? formatDayKey(value) : 'Choose date'}</span>
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 border border-black bg-white p-3 shadow-[4px_4px_0_0_#1F1D1A]">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setView((v) => addMonths(v.year, v.monthIndex, -1))}
              className="h-8 w-8 border border-black font-mono text-sm hover:bg-gray-100"
            >
              ‹
            </button>
            <span className="font-mono text-sm font-bold">
              {monthLabel(view.year, view.monthIndex)}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setView((v) => addMonths(v.year, v.monthIndex, 1))}
              className="h-8 w-8 border border-black font-mono text-sm hover:bg-gray-100"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((d) => (
              <span
                key={d}
                className="text-center font-mono text-[10px] uppercase tracking-wider text-gray-500"
              >
                {d}
              </span>
            ))}
            {weeks.flat().map((key, i) =>
              key ? (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onChange(key)
                    setOpen(false)
                  }}
                  className={cn(
                    'h-8 font-mono text-xs transition-colors hover:bg-gray-100',
                    key === value
                      ? 'bg-black text-white hover:bg-black'
                      : key === today
                        ? 'border border-clay-600 text-clay-700'
                        : 'text-black'
                  )}
                >
                  {Number(key.slice(-2))}
                </button>
              ) : (
                <span key={`pad-${i}`} />
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
