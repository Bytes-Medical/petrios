'use client'

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

/**
 * Themed dropdown. A native <select>'s OPEN menu is OS-rendered and cannot
 * be styled, so this renders a custom listbox in the house style instead
 * (border-black, paper background, hard shadow, mono type, clay focus).
 *
 * Drop-in for the old native-select wrapper: accepts <option> children,
 * label/name/value/defaultValue/onChange(e.target.value)/required/disabled,
 * and carries name+value via a hidden input so FormData keeps working.
 */

export interface SelectChangeEvent {
  target: { value: string; name?: string }
}

export interface SelectProps {
  label?: string
  name?: string
  id?: string
  value?: string
  defaultValue?: string
  onChange?: (event: SelectChangeEvent) => void
  required?: boolean
  disabled?: boolean
  className?: string
  'aria-label'?: string
  children: ReactNode
}

interface ParsedOption {
  value: string
  label: string
  disabled: boolean
}

function parseOptions(children: ReactNode): ParsedOption[] {
  const options: ParsedOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const el = child as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>
    if (el.type === 'option') {
      const props = el.props
      const label = childText(props.children)
      options.push({
        value: props.value !== undefined ? String(props.value) : label,
        label,
        disabled: !!props.disabled,
      })
    } else if (el.type === 'optgroup') {
      options.push(...parseOptions((el.props as { children?: ReactNode }).children))
    }
  })
  return options
}

function childText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(childText).join('')
  if (isValidElement(node)) return childText((node.props as { children?: ReactNode }).children)
  return ''
}

export function Select({
  label,
  name,
  id,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  className,
  'aria-label': ariaLabel,
  children,
}: SelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  const listboxId = `${selectId}-listbox`

  const options = useMemo(() => parseOptions(children), [children])
  const fallback = options.find((o) => !o.disabled)?.value ?? ''

  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = useState(defaultValue ?? fallback)
  const currentValue = isControlled ? value : internalValue
  const selected = options.find((o) => o.value === currentValue)

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  function commit(option: ParsedOption) {
    if (option.disabled) return
    if (!isControlled) setInternalValue(option.value)
    onChange?.({ target: { value: option.value, name } })
    setOpen(false)
  }

  function openMenu() {
    if (disabled) return
    const selectedIndex = options.findIndex((o) => o.value === currentValue)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled))
    setOpen(true)
  }

  function move(from: number, step: number): number {
    let i = from
    for (let n = 0; n < options.length; n++) {
      i = (i + step + options.length) % options.length
      if (!options[i].disabled) return i
    }
    return from
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        openMenu()
      }
      return
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => move(i, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => move(i, -1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(move(-1, 1))
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(move(0, -1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (options[activeIndex]) commit(options[activeIndex])
        break
      default: {
        // Single-character type-ahead (e.g. jump to "13:00" by typing "1").
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const query = e.key.toLowerCase()
          const start = activeIndex + 1
          for (let n = 0; n < options.length; n++) {
            const i = (start + n) % options.length
            if (!options[i].disabled && options[i].label.toLowerCase().startsWith(query)) {
              setActiveIndex(i)
              break
            }
          }
        }
      }
    }
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  // Keep the active option visible while navigating.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    menuRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  return (
    <div className="w-full" ref={rootRef}>
      {label && (
        <label
          htmlFor={selectId}
          className="block mb-1 text-sm font-mono"
          onClick={() => (open ? setOpen(false) : openMenu())}
        >
          {label}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          id={selectId}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-label={ariaLabel ?? label}
          aria-required={required}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex w-full items-center justify-between gap-2 px-3 py-2 border border-black font-mono text-sm bg-white text-left transition-colors',
            'focus:outline-none focus:border-clay-600 focus:ring-1 focus:ring-clay-600',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50',
            className
          )}
        >
          <span className={cn('truncate', !selected && 'text-gray-500')}>
            {selected ? selected.label : 'Select…'}
          </span>
          <span aria-hidden="true" className="shrink-0 text-xs">
            {open ? '▴' : '▾'}
          </span>
        </button>

        {open && (
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? label}
            className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto border border-black bg-white shadow-[4px_4px_0_rgba(31,29,26,0.25)]"
          >
            {options.map((option, index) => {
              const isSelected = option.value === currentValue
              const isActive = index === activeIndex
              return (
                <li
                  key={`${option.value}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-index={index}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(option)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 font-mono text-sm',
                    option.disabled && 'cursor-not-allowed text-gray-400',
                    !option.disabled && isActive && 'bg-black text-white',
                    !option.disabled && !isActive && isSelected && 'bg-gray-100'
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected ? (
                    <span aria-hidden="true" className={cn('shrink-0', isActive ? 'text-clay-400' : 'text-clay-600')}>
                      ▪
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {name ? <input type="hidden" name={name} value={currentValue} /> : null}
    </div>
  )
}
