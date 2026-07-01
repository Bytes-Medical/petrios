import { InputHTMLAttributes, forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, className, id, ...props }, ref) => {
    const autoId = useId()
    const inputId = id ?? (label ? autoId : undefined)

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block mb-1 text-sm font-mono">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full px-3 py-2 border border-black font-mono text-sm bg-white transition-colors',
            'placeholder:text-gray-400',
            'focus:outline-none focus:border-clay-600 focus:ring-1 focus:ring-clay-600',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50',
            'aria-[invalid=true]:border-red-700 aria-[invalid=true]:ring-red-700',
            className
          )}
          {...props}
        />
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
