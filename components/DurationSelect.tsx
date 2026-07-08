import { Select } from './Select'
import {
  formatDuration,
  listDurationOptions,
} from '@/lib/session-duration'

interface DurationSelectProps {
  name: string
  label?: string
  defaultMinutes?: number
  /** A legacy off-grid duration (e.g. 100 min) to surface as an extra option
   *  so editing an old session never silently shifts its end time. */
  extraOptionMinutes?: number
  required?: boolean
}

export function DurationSelect({
  name,
  label = 'Duration',
  defaultMinutes = 60,
  extraOptionMinutes,
  required,
}: DurationSelectProps) {
  const options = listDurationOptions()
  if (
    extraOptionMinutes !== undefined &&
    extraOptionMinutes > 0 &&
    !options.includes(extraOptionMinutes)
  ) {
    options.push(extraOptionMinutes)
    options.sort((a, b) => a - b)
  }

  return (
    <Select
      label={label}
      name={name}
      defaultValue={String(defaultMinutes)}
      required={required}
    >
      {options.map((mins) => (
        <option key={mins} value={mins}>
          {formatDuration(mins)}
        </option>
      ))}
    </Select>
  )
}
