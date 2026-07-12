'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Select } from './Select'
import { DurationSelect } from './DurationSelect'
import { useToast } from './ToastProvider'
import { createTeachingSlots } from '@/app/actions/teaching-slots'
import {
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  formatDayKey,
  monthLabel,
  todayKey,
} from '@/lib/date-picker'
import { listSlotTimeOptions } from '@/lib/slot-schedule'
import type { LocationType } from '@/lib/types'
import { cn, fieldStyles } from '@/lib/utils'

interface BulkSlotPickerProps {
  departmentId: string
  /** Day keys that already contain a session or an active slot (dot marker). */
  busyDayKeys: string[]
}

/**
 * Calendly-style bulk availability picker: multi-select days across months,
 * set batch defaults (time, duration, location), create the open slots.
 */
export function BulkSlotPicker({ departmentId, busyDayKeys }: BulkSlotPickerProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const now = new Date()
  const [view, setView] = useState({ year: now.getFullYear(), monthIndex: now.getMonth() })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [time, setTime] = useState('13:00')
  const [loading, setLoading] = useState(false)

  const today = todayKey()
  const busy = new Set(busyDayKeys)
  const weeks = buildMonthGrid(view.year, view.monthIndex)
  const timeOptions = listSlotTimeOptions(15)

  function toggleDay(key: string) {
    if (key < today) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleCreate(formData: FormData) {
    setLoading(true)
    try {
      const result = await createTeachingSlots(departmentId, {
        dayKeys: Array.from(selected),
        time,
        durationMins: Number(formData.get('duration')),
        locationType: formData.get('location_type') as LocationType,
      })
      showToast({
        variant: 'success',
        title: `${result.created} slot${result.created === 1 ? '' : 's'} created`,
        description: 'Publish them below to invite teachers to claim.',
      })
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to create slots',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(false)
    }
  }

  const sortedSelection = Array.from(selected).sort()

  return (
    <form
      className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]"
      onSubmit={(e) => {
        e.preventDefault()
        void handleCreate(new FormData(e.currentTarget))
      }}
    >
      {/* Month grid */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setView((v) => addMonths(v.year, v.monthIndex, -1))}
            className="h-9 w-9 border border-black font-mono text-sm hover:bg-gray-100"
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
            className="h-9 w-9 border border-black font-mono text-sm hover:bg-gray-100"
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
                disabled={key < today}
                onClick={() => toggleDay(key)}
                className={cn(
                  'relative h-12 border font-mono text-sm transition-colors',
                  key < today
                    ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                    : selected.has(key)
                      ? 'border-black bg-black text-white'
                      : key === today
                        ? 'border-clay-600 text-clay-700 hover:bg-gray-100'
                        : 'border-gray-300 hover:bg-gray-100'
                )}
              >
                {Number(key.slice(-2))}
                {busy.has(key) && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2',
                      selected.has(key) ? 'bg-clay-400' : 'bg-clay-600'
                    )}
                  />
                )}
              </button>
            ) : (
              <span key={`pad-${i}`} />
            )
          )}
        </div>
        <p className="mt-2 font-mono text-[11px] text-gray-500">
          <span aria-hidden="true" className="mr-1 inline-block h-1.5 w-1.5 bg-clay-600 align-middle" />
          day already has a session or slot · click days to select, across any months
        </p>
      </div>

      {/* Batch defaults */}
      <div className="space-y-4">
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-gray-500">
          Batch defaults
        </h3>

        <div className="w-full">
          <label htmlFor="slot-time" className="block mb-1 text-sm font-mono">
            Start time
          </label>
          <select
            id="slot-time"
            className={`${fieldStyles} w-full`}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          >
            {timeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <DurationSelect name="duration" defaultMinutes={60} required />

        <Select label="Location Type" name="location_type" defaultValue="MS_TEAMS" required>
          <option value="JITSI">Petrios Meet (Video)</option>
        <option value="MS_TEAMS">MS Teams</option>
          <option value="IN_PERSON">In Person</option>
          <option value="HYBRID">Hybrid</option>
        </Select>

        <div>
          <p className="mb-1 font-mono text-sm">
            Selected dates ({sortedSelection.length})
          </p>
          {sortedSelection.length === 0 ? (
            <p className="font-mono text-xs text-gray-500">
              Nothing selected yet — click dates on the calendar.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sortedSelection.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDay(key)}
                  className="border border-black bg-white px-2 py-0.5 font-mono text-xs hover:bg-gray-100"
                  title="Remove"
                >
                  {formatDayKey(key)} ×
                </button>
              ))}
            </div>
          )}
        </div>

        <Button type="submit" disabled={sortedSelection.length === 0 || loading}>
          {loading
            ? 'Creating...'
            : `Create ${sortedSelection.length || ''} slot${sortedSelection.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </form>
  )
}
