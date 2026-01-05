import { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export function Input({ label, className = '', ...props }: InputProps) {
  const inputStyles = 'w-full px-3 py-2 border border-black font-mono text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black'
  
  return (
    <div className="w-full">
      {label && (
        <label className="block mb-1 text-sm font-mono">
          {label}
        </label>
      )}
      <input
        className={`${inputStyles} ${className}`}
        {...props}
      />
    </div>
  )
}
