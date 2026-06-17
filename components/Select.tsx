import { SelectHTMLAttributes, ReactNode } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  children: ReactNode
}

export function Select({ label, className = '', children, ...props }: SelectProps) {
  const selectStyles = 'w-full px-3 py-2 border border-black font-mono text-sm bg-white focus:outline-none focus:border-clay-600 focus:ring-1 focus:ring-clay-600'
  
  return (
    <div className="w-full">
      {label && (
        <label className="block mb-1 text-sm font-mono">
          {label}
        </label>
      )}
      <select
        className={`${selectStyles} ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}
