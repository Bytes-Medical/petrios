'use client'

import { useState } from 'react'

interface DateTimePickerProps {
  label?: string
  name: string
  /** ISO string or 'YYYY-MM-DDTHH:mm' to pre-fill. */
  defaultValue?: string
  required?: boolean
  /** Time granularity in minutes. Defaults to 15. */
  intervalMinutes?: number
}

// Matches Input/Select tokens, but with a fixed height so the native date input
// and the custom time select line up to the exact same box.
const fieldStyles =
  'h-10 px-3 border border-black font-mono text-sm bg-white focus:outline-none focus:border-clay-600 focus:ring-1 focus:ring-clay-600'

const pad = (n: number) => n.toString().padStart(2, '0')

/** Split a default value into local date ('YYYY-MM-DD') and time ('HH:mm') parts. */
function splitDefault(value?: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** Build 'HH:mm' options across the day at the given interval. */
function buildTimeOptions(intervalMinutes: number): string[] {
  const options: string[] = []
  for (let minutes = 0; minutes < 24 * 60; minutes += intervalMinutes) {
    options.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`)
  }
  return options
}

export function DateTimePicker({
  label,
  name,
  defaultValue,
  required,
  intervalMinutes = 15,
}: DateTimePickerProps) {
  const initial = splitDefault(defaultValue)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)

  const options = buildTimeOptions(intervalMinutes)
  // Preserve an off-grid legacy time (e.g. a session saved at 10:07) so editing
  // never silently shifts it — surface it as a selectable option instead.
  if (initial.time && !options.includes(initial.time)) {
    options.push(initial.time)
    options.sort()
  }

  const combined = date && time ? `${date}T${time}` : ''

  return (
    <div className="w-full">
      {label && <label className="block mb-1 text-sm font-mono">{label}</label>}
      <div className="flex items-stretch gap-2">
        <input
          type="date"
          className={`${fieldStyles} min-w-0 flex-[2]`}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required={required}
          aria-label={label ? `${label} — date` : 'Date'}
        />
        <select
          className={`${fieldStyles} min-w-0 flex-1`}
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required={required}
          aria-label={label ? `${label} — time` : 'Time'}
        >
          <option value="" disabled>
            Time
          </option>
          {options.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {/* Single combined value so existing form handlers read `name` unchanged. */}
      <input type="hidden" name={name} value={combined} />
    </div>
  )
}
