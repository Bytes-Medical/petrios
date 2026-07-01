import { TextareaHTMLAttributes, forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, className, id, ...props }, ref) => {
    const autoId = useId()
    const textareaId = id ?? (label ? autoId : undefined)

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block mb-1 text-sm font-mono">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            'w-full px-3 py-2 border border-black font-mono text-sm bg-white transition-colors resize-y',
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
Textarea.displayName = 'Textarea'

export { Textarea }
