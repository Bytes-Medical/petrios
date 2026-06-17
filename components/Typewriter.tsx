'use client'

import { useState, useEffect } from 'react'

interface TypewriterProps {
  text: string
  speed?: number
  className?: string
}

export function Typewriter({ text, speed = 50, className = '' }: TypewriterProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (currentIndex >= text.length) return

    const timeout = setTimeout(() => {
      setCurrentIndex(prev => prev + 1)
    }, speed)

    return () => clearTimeout(timeout)
  }, [currentIndex, text, speed])

  return (
    <span className={className}>
      {text.slice(0, currentIndex)}
      <span className="animate-pulse text-clay-500" aria-hidden="true">▌</span>
    </span>
  )
}
