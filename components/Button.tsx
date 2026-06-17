import { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
}

export function Button({ children, variant = 'primary', className = '', ...props }: ButtonProps) {
  const baseStyles = 'px-4 py-2 border font-mono text-sm transition-colors active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0 whitespace-nowrap'

  const variants = {
    primary: 'border-clay-600 bg-clay-600 text-white hover:bg-clay-700 hover:border-clay-700',
    secondary: 'border-black bg-white text-black hover:bg-gray-50',
    danger: 'border-red-700 bg-white text-red-700 hover:bg-red-700 hover:text-white',
  }

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
