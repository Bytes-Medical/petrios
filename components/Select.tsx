import { SelectHTMLAttributes, forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, className, id, children, ...props }, ref) => {
    const autoId = useId()
    const selectId = id ?? (label ? autoId : undefined)

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="block mb-1 text-sm font-mono">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full px-3 py-2 border border-black font-mono text-sm bg-white transition-colors',
            'focus:outline-none focus:border-clay-600 focus:ring-1 focus:ring-clay-600',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50',
            'aria-[invalid=true]:border-red-700 aria-[invalid=true]:ring-red-700',
            className
          )}
          {...props}
        >
          {children}
        </select>
      </div>
    )
  }
)
Select.displayName = 'Select'

export { Select }
