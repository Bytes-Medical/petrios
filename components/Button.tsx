import { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
}

export function Button({ children, variant = 'primary', className = '', ...props }: ButtonProps) {
  const baseStyles = 'px-4 py-2 border font-mono text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
  
  const variants = {
    primary: 'border-black bg-black text-white hover:bg-gray-900',
    secondary: 'border-black bg-white text-black hover:bg-gray-50',
    danger: 'border-black bg-white text-black hover:bg-red-50',
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
