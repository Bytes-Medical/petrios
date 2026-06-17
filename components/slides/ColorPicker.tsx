'use client'

import { useEffect, useRef, useState } from 'react'
import { MEMPHIS_PALETTE, getTheme, resolveColor } from '@/lib/slides'

interface ColorPickerProps {
  value?: string
  onChange: (value: string) => void
  themeId: string
  /** Show a "None" option that emits '' (e.g. for highlight / border). */
  allowNone?: boolean
  label?: string
}

/**
 * Colour control: theme-token swatches (so a value can follow the theme), the
 * on-brand Memphis palette, a native picker and a hex field for custom colours.
 * Emits either a `theme:*` token or a raw hex string.
 */
export function ColorPicker({ value, onChange, themeId, allowNone, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const theme = getTheme(themeId)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const resolved = resolveColor(value, theme)
  const swatch = resolved || (allowNone ? 'transparent' : '#ffffff')

  const tokens: { token: string; name: string }[] = [
    { token: 'theme:text', name: 'Text' },
    { token: 'theme:muted', name: 'Muted' },
    ...theme.accents.map((_, i) => ({ token: `theme:accent${i + 1}`, name: `Accent ${i + 1}` })),
    { token: 'theme:bg', name: 'Background' },
  ]

  function pick(v: string) {
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-2 border border-black px-2 font-mono text-xs"
      >
        <span
          className="h-4 w-4 shrink-0 border border-gray-400"
          style={{
            background:
              swatch === 'transparent'
                ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px'
                : swatch,
          }}
        />
        <span className="truncate text-gray-600">{label ?? resolved ?? 'None'}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-52 border border-black bg-white p-2 shadow-lg">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-gray-500">Theme</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {tokens.map((t) => (
              <button
                key={t.token}
                type="button"
                title={t.name}
                onClick={() => pick(t.token)}
                className="h-6 w-6 border border-gray-400"
                style={{ background: resolveColor(t.token, theme) }}
              />
            ))}
          </div>

          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-gray-500">Palette</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {MEMPHIS_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => pick(c)}
                className="h-6 w-6 border border-gray-400"
                style={{ background: c }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="color"
              value={resolved && resolved.startsWith('#') ? resolved : '#000000'}
              onChange={(e) => onChange(e.target.value)}
              className="h-8 w-8 border border-black p-0"
            />
            <input
              type="text"
              value={value ?? ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder="#hex or theme:accent1"
              className="min-w-0 flex-1 border border-black px-1 py-1 font-mono text-[11px]"
            />
          </div>

          {allowNone && (
            <button
              type="button"
              onClick={() => pick('')}
              className="mt-2 w-full border border-black px-2 py-1 font-mono text-[11px] hover:bg-gray-50"
            >
              None
            </button>
          )}
        </div>
      )}
    </div>
  )
}
