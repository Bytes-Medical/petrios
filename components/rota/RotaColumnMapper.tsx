'use client'

import { Select } from '@/components/Select'
import type { RotaProfileConfig } from '@/lib/rota/profile'

/**
 * Step 2 of the rota upload: layout and column map. Only header NAMES are
 * kept in the profile. The five-row preview is rendered from the file in
 * this browser and never leaves it.
 */

type ColumnKey = 'staffId' | 'email' | 'name' | 'date' | 'code' | 'start' | 'end'

const COLUMN_LABELS: Record<ColumnKey, string> = {
  staffId: 'Staff number / ESR assignment',
  email: 'Email',
  name: 'Name',
  date: 'Duty date',
  code: 'Shift code',
  start: 'Start time',
  end: 'End time',
}

export function RotaColumnMapper({
  header,
  previewRows,
  config,
  onChange,
}: {
  header: string[]
  previewRows: string[][]
  config: RotaProfileConfig
  onChange: (config: RotaProfileConfig) => void
}) {
  const columnKeys: ColumnKey[] =
    config.layout === 'LONG' ? ['staffId', 'email', 'name', 'date', 'code', 'start', 'end'] : ['staffId', 'email', 'name']

  function setLayout(layout: 'WIDE' | 'LONG') {
    const { staffId, email, name } = config.columns
    const keep = { ...(staffId ? { staffId } : {}), ...(email ? { email } : {}), ...(name ? { name } : {}) }
    onChange({ ...config, layout, columns: layout === 'WIDE' ? { ...keep, dateColumns: 'AUTO' } : keep })
  }

  function setColumn(key: ColumnKey, value: string) {
    const columns = { ...config.columns }
    if (value) columns[key] = value
    else delete columns[key]
    onChange({ ...config, columns })
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Layout" value={config.layout} onChange={(e) => setLayout(e.target.value as 'WIDE' | 'LONG')}>
          <option value="WIDE">Grid: one row per person, one column per date</option>
          <option value="LONG">List: one row per duty</option>
        </Select>
        <Select
          label="Date format"
          value={config.dateFormat}
          onChange={(e) => onChange({ ...config, dateFormat: e.target.value as RotaProfileConfig['dateFormat'] })}
        >
          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          <option value="DD-MMM-YYYY">DD-MMM-YYYY (05-Oct-2026)</option>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {columnKeys.map((key) => (
          <Select
            key={key}
            label={COLUMN_LABELS[key]}
            value={config.columns[key] ?? ''}
            onChange={(e) => setColumn(key, e.target.value)}
          >
            <option value="">Not in this file</option>
            {header.map((name, index) =>
              name ? (
                <option key={`${index}-${name}`} value={name}>
                  {name}
                </option>
              ) : null
            )}
          </Select>
        ))}
      </div>

      {config.layout === 'WIDE' ? (
        <p className="font-mono text-xs text-gray-600">
          Grid layout: every column whose header reads as a date in the chosen format is used as that day.
        </p>
      ) : null}

      <label className="flex items-start gap-2 font-mono text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={config.idNormalisation.stripAssignmentSuffix}
          onChange={(e) => onChange({ ...config, idNormalisation: { stripAssignmentSuffix: e.target.checked } })}
        />
        <span>Ignore the assignment suffix after a dash in staff numbers (12345678-2 → 12345678)</span>
      </label>

      <div>
        <h4 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-gray-500">
          Preview (first rows, stays in this browser)
        </h4>
        <div className="overflow-x-auto border border-black">
          <table className="min-w-full font-mono text-xs">
            <thead className="bg-gray-50">
              <tr>
                {header.slice(0, 12).map((name, index) => (
                  <th key={index} className="whitespace-nowrap border-b border-black px-2 py-1 text-left">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, r) => (
                <tr key={r}>
                  {header.slice(0, 12).map((_, c) => (
                    <td key={c} className="whitespace-nowrap px-2 py-1">
                      {row[c] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {header.length > 12 ? (
          <p className="mt-1 font-mono text-xs text-gray-500">Showing the first 12 of {header.length} columns.</p>
        ) : null}
      </div>
    </div>
  )
}
