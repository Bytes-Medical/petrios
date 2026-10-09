'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => undefined

function useBrowserFormatting() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
}

export function LocalDateTime({
  value,
  options,
}: {
  value: string
  options?: Intl.DateTimeFormatOptions
}) {
  const canFormat = useBrowserFormatting()
  const formatted = canFormat
    ? new Date(value).toLocaleString('en-GB', options)
    : 'Loading time…'

  return <time dateTime={value}>{formatted}</time>
}

export function LocalSessionDateRange({
  dateStart,
  dateEnd,
}: {
  dateStart: string
  dateEnd: string
}) {
  const canFormat = useBrowserFormatting()
  if (!canFormat) {
    return <span>Loading time…</span>
  }

  const start = new Date(dateStart)
  const end = new Date(dateEnd)
  const date = start.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const startTime = start.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const endTime = end.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <>
      <time dateTime={dateStart}>{date} · {startTime}</time>
      {' – '}
      <time dateTime={dateEnd}>{endTime}</time>
    </>
  )
}
