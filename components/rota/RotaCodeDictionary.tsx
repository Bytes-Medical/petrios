'use client'

import { isNightCode } from '@/lib/rota/dictionary'
import type { RotaCodeEntry, RotaProfileConfig } from '@/lib/rota/profile'

/**
 * Step 3 of the rota upload: the code dictionary. Every distinct code in the
 * file must be mapped to a status (or explicitly ignored) before the upload
 * can be sent. Codes become letters here, in the browser; the codes
 * themselves are never sent. There is deliberately no category: every kind
 * of leave (annual, sick, study, parental) maps to the one "Leave" status.
 *
 * Post-night rest (O4) follows the codes that are nights: ticked "Night"
 * (N or D, with times) or a timed N crossing midnight (isNightCode). Each row
 * says how it will be read, so an untimed N is never mistaken for a night.
 */

function nightHint(entry: RotaCodeEntry | undefined): string | null {
  if (!entry) return null
  if (entry.letter === 'N' && (entry.start === undefined || entry.end === undefined)) {
    return 'Counts as a whole rest day. For a night shift, tick Night and add times.'
  }
  if (isNightCode(entry, entry.start, entry.end)) return 'Night: post-night rest follows a run of these.'
  if (entry.letter === 'D' && entry.start && entry.end && entry.end <= entry.start) {
    return 'Crosses midnight. Tick Night if this is a night shift, so rest follows it.'
  }
  return null
}

const LETTER_LABELS: { value: RotaCodeEntry['letter']; label: string }[] = [
  { value: 'A', label: 'Available (normal day shift)' },
  { value: 'D', label: 'On duty elsewhere (on call, long day)' },
  { value: 'N', label: 'Night or rest' },
  { value: 'X', label: 'Not working (whole day)' },
  { value: 'L', label: 'Leave of any kind (whole day)' },
  { value: 'IGNORE', label: 'Ignore (read as unknown)' },
]

function canHaveTimes(letter: RotaCodeEntry['letter'] | undefined): boolean {
  return letter === 'A' || letter === 'D' || letter === 'N'
}

export function RotaCodeDictionary({
  distinctCodes,
  config,
  onChange,
}: {
  distinctCodes: { code: string; count: number }[]
  config: RotaProfileConfig
  onChange: (config: RotaProfileConfig) => void
}) {
  function update(code: string, next: RotaCodeEntry | null) {
    const codes = { ...config.codes }
    if (next) codes[code] = next
    else delete codes[code]
    onChange({ ...config, codes })
  }

  function setLetter(code: string, value: string) {
    if (!value) return update(code, null)
    const letter = value as RotaCodeEntry['letter']
    const current = config.codes[code]
    const next: RotaCodeEntry = { letter }
    if (canHaveTimes(letter) && current?.start && current?.end) {
      next.start = current.start
      next.end = current.end
      if (current.night && (letter === 'N' || letter === 'D')) next.night = true
    }
    update(code, next)
  }

  function setTime(code: string, field: 'start' | 'end', value: string) {
    const current = config.codes[code]
    if (!current) return
    const next: RotaCodeEntry = { ...current }
    if (value) next[field] = value
    else delete next[field]
    update(code, next)
  }

  function setNight(code: string, night: boolean) {
    const current = config.codes[code]
    if (!current) return
    const next: RotaCodeEntry = { ...current }
    if (night) next.night = true
    else delete next.night
    update(code, next)
  }

  if (distinctCodes.length === 0) {
    return <p className="font-mono text-sm text-gray-600">No shift codes were found for the upload window.</p>
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs leading-5 text-gray-600">
        Map every code. A cell with several codes (for example <code>LD/OC</code>) takes the least available status.
        Tick <strong>Night</strong> for night shifts (mapped to nights or to on duty elsewhere) and give their start
        and end times: post-night rest follows them. A nights code with times that cross midnight also counts as a
        night; a nights code without times is read as a whole rest day. Leave, not-working and ignored codes are
        always whole days.
      </p>
      <div className="overflow-x-auto border border-black">
        <table className="min-w-full font-mono text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="border-b border-black px-2 py-2 text-left">Code</th>
              <th className="border-b border-black px-2 py-2 text-right">Uses</th>
              <th className="border-b border-black px-2 py-2 text-left">Status</th>
              <th className="border-b border-black px-2 py-2 text-left">Start</th>
              <th className="border-b border-black px-2 py-2 text-left">End</th>
              <th className="border-b border-black px-2 py-2 text-left">Night</th>
            </tr>
          </thead>
          <tbody>
            {distinctCodes.map(({ code, count }) => {
              const entry = Object.prototype.hasOwnProperty.call(config.codes, code) ? config.codes[code] : undefined
              const timed = canHaveTimes(entry?.letter)
              const hint = nightHint(entry)
              return (
                <tr key={code} className={entry ? '' : 'bg-amber-50'}>
                  <td className="px-2 py-1 align-top">
                    <span className="whitespace-nowrap font-bold">{code}</span>
                    {hint ? <span className="mt-1 block max-w-[16rem] text-[11px] leading-4 text-gray-600">{hint}</span> : null}
                  </td>
                  <td className="px-2 py-1 text-right">{count}</td>
                  <td className="px-2 py-1">
                    <select
                      aria-label={`Status for ${code}`}
                      className="w-full border border-black bg-white px-2 py-1"
                      value={entry?.letter ?? ''}
                      onChange={(e) => setLetter(code, e.target.value)}
                    >
                      <option value="">Choose…</option>
                      {LETTER_LABELS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="time"
                      aria-label={`Start time for ${code}`}
                      className="border border-black px-1 py-1 disabled:opacity-40"
                      disabled={!timed}
                      value={entry?.start ?? ''}
                      onChange={(e) => setTime(code, 'start', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="time"
                      aria-label={`End time for ${code}`}
                      className="border border-black px-1 py-1 disabled:opacity-40"
                      disabled={!timed}
                      value={entry?.end ?? ''}
                      onChange={(e) => setTime(code, 'end', e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      aria-label={`${code} is a night shift`}
                      disabled={!(entry?.letter === 'N' || entry?.letter === 'D')}
                      checked={entry?.night === true}
                      onChange={(e) => setNight(code, e.target.checked)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
