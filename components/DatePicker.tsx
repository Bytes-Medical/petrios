'use client'

import { useRef, useState } from 'react'
import {
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  formatDayKey,
  monthLabel,
  todayKey,
} from '@/lib/date-picker'
import { useDismissable } from '@/hooks/useDismissable'
import { cn, fieldStyles } from '@/lib/utils'

interface DatePickerProps {
  /** 'YYYY-MM-DD' or '' */
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
}

/** Themed replacement for the native date input: a monospace popover calendar. */
export function DatePicker({ value, onChange, ariaLabel, className }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const initial = value ? new Date(value) : new Date()
  const [view, setView] = useState({
    year: initial.getFullYear(),
    monthIndex: initial.getMonth(),
  })

  useDismissable(containerRef, open, () => setOpen(false))

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
