'use client'

import { useState } from 'react'
import { DatePicker } from './DatePicker'
import { dayKeyFromIso, formatTimeHM } from '@/lib/date-picker'
import { listSlotTimeOptions } from '@/lib/slot-schedule'
import { fieldStyles } from '@/lib/utils'

interface DateTimePickerProps {
  label?: string
  name: string
  /** ISO string or 'YYYY-MM-DDTHH:mm' to pre-fill. */
  defaultValue?: string
  required?: boolean
  /** Time granularity in minutes. Defaults to 15. */
  intervalMinutes?: number
}

/** Split a default value into local date ('YYYY-MM-DD') and time ('HH:mm') parts. */
function splitDefault(value?: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  return { date: dayKeyFromIso(value), time: formatTimeHM(value) }
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

  const options = listSlotTimeOptions(intervalMinutes)
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
        <DatePicker
          className="min-w-0 flex-[2]"
          value={date}
          onChange={setDate}
          ariaLabel={label ? `${label} — date` : 'Date'}
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
