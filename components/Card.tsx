import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`border border-black p-4 sm:p-6 bg-white ${className}`}>
      {children}
    </div>
  )
}
