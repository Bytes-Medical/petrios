import { TextareaHTMLAttributes } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function Textarea({ label, className = '', ...props }: TextareaProps) {
  const textareaStyles = 'w-full px-3 py-2 border border-black font-mono text-sm bg-white focus:outline-none focus:border-clay-600 focus:ring-1 focus:ring-clay-600 resize-y'
  
  return (
    <div className="w-full">
      {label && (
        <label className="block mb-1 text-sm font-mono">
          {label}
        </label>
      )}
      <textarea
        className={`${textareaStyles} ${className}`}
        {...props}
      />
    </div>
  )
}
