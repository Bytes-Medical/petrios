'use client'

// Must be first import — sets globalThis.Temporal for schedule-x
import 'temporal-polyfill/global'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ScheduleXCalendar, useNextCalendarApp } from '@schedule-x/react'
import { viewDay, viewWeek, viewMonthGrid } from '@schedule-x/calendar'
import { createEventsServicePlugin } from '@schedule-x/events-service'
import '@schedule-x/theme-default/dist/index.css'
import { formatTimeHM } from '@/lib/date-picker'
import { sessionMeetingUrl } from '@/lib/jitsi'
import type { Session, SlotEvent } from '@/lib/types'

type ExpandedDay = {
  date: string
  sessions: Session[]
  slots: SlotEvent[]
  position: {
    top: number
    left: number
    width: number
    maxHeight: number
    arrowSide: 'left' | 'right'
    arrowTop: number
  }
}

function toZonedDateTime(iso: string): Temporal.ZonedDateTime {
  const instant = Temporal.Instant.from(new Date(iso).toISOString())
  return instant.toZonedDateTimeISO(Temporal.Now.timeZoneId())
}

function getCalendarEventTitle(session: Session) {
  if (session.status === 'DRAFT') return `[Draft] ${session.title}`
  if (session.status === 'CANCELLED') return `Cancelled: ${session.title}`
  return session.title
}

function getLocalDateKey(iso: string) {
  return toZonedDateTime(iso).toPlainDate().toString()
}

function sessionOccursOnDate(session: Session, date: string) {
  return getLocalDateKey(session.date_start) <= date && getLocalDateKey(session.date_end) >= date
}

function getSessionsForDate(sessions: Session[], date: string) {
  return sessions
    .filter((session) => sessionOccursOnDate(session, date))
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())
}

function getSlotsForDate(slots: SlotEvent[], date: string) {
  return slots
    .filter((slot) => getLocalDateKey(slot.date_start) === date)
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())
}

function sessionsToEvents(sessions: Session[]) {
  return sessions
    .filter((session) => session.date_start && session.date_end)
    .map((session) => ({
      id: session.id,
      title: getCalendarEventTitle(session),
      start: toZonedDateTime(session.date_start),
      end: toZonedDateTime(session.date_end),
      location:
        session.location_type === 'MS_TEAMS'
          ? 'Microsoft Teams'
          : session.location_type === 'HYBRID'
            ? 'Hybrid'
            : 'In Person',
      description: session.description || undefined,
      calendarId: session.status === 'PUBLISHED' ? 'published' : 'draft',
    }))
}

// Slot pseudo-events are id-namespaced with 'slot-' so onEventClick can tell
// them apart from sessions.
const SLOT_EVENT_PREFIX = 'slot-'

function slotsToEvents(slots: SlotEvent[]) {
  return slots.map((slot) => ({
    id: `${SLOT_EVENT_PREFIX}${slot.id}`,
    title: 'Available — open slot',
    start: toZonedDateTime(slot.date_start),
    end: toZonedDateTime(slot.date_end),
    calendarId: 'available',
  }))
}

function formatSessionDateRange(session: Session) {
  const start = new Date(session.date_start)
  const end = new Date(session.date_end)

  return `${start.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })} ${start.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })} - ${end.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function formatDayHeading(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function formatSessionStart(session: Session) {
  return new Date(session.date_start).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSessionDuration(session: Session) {
  const minutes = Math.max(
    1,
    Math.round((new Date(session.date_end).getTime() - new Date(session.date_start).getTime()) / 60000)
  )

  if (minutes < 60) {
    return `${minutes} min`
  }

  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1 ? '1 hour' : `${hours} hours`
  }

  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} hrs`
}

function getLocationLabel(session: Session) {
  if (session.location_type === 'HYBRID') return 'Hybrid session'
  if (session.location_type === 'MS_TEAMS') return session.teams_meeting_url ? 'Microsoft Teams' : 'Online'
  if (session.location_type === 'JITSI') return 'Byte Meet video'
  return 'In person'
}

function getExpandedDayPosition(anchorRect: DOMRect): ExpandedDay['position'] {
  const gap = 14
  const viewportPadding = 16
  const width = Math.min(420, window.innerWidth - viewportPadding * 2)
  const maxHeight = Math.min(520, window.innerHeight - viewportPadding * 2)
  const fitsRight = anchorRect.right + gap + width <= window.innerWidth - viewportPadding
  const left = fitsRight
    ? anchorRect.right + gap
    : Math.max(viewportPadding, anchorRect.left - gap - width)
  const top = Math.min(
    Math.max(viewportPadding, anchorRect.top - 18),
    window.innerHeight - maxHeight - viewportPadding
  )

  return {
    top,
    left,
    width,
    maxHeight,
    arrowSide: fitsRight ? 'left' : 'right',
    arrowTop: Math.min(Math.max(32, anchorRect.top + anchorRect.height / 2 - top), maxHeight - 32),
  }
}

export function SessionCalendar({
  sessions,
  subscriptionUrl,
  slots = [],
}: {
  sessions: Session[]
  subscriptionUrl: string
  /** Open teaching slots shown as claimable 'Available' events. */
  slots?: SlotEvent[]
}) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<SlotEvent | null>(null)
  const [expandedDay, setExpandedDay] = useState<ExpandedDay | null>(null)
  const [eventsService] = useState(() => createEventsServicePlugin())
  const sessionsRef = useRef(sessions)
  const slotsRef = useRef(slots)
  const calendarWrapperRef = useRef<HTMLDivElement | null>(null)

  const calendarApp = useNextCalendarApp({
    defaultView: viewMonthGrid.name,
    views: [viewMonthGrid, viewWeek, viewDay],
    events: [...sessionsToEvents(sessions), ...slotsToEvents(slots)],
    monthGridOptions: {
      nEventsPerDay: 2,
    },
    calendars: {
      published: {
        colorName: 'published',
        lightColors: {
          main: '#C25D3D',
          container: '#F6E3DA',
          onContainer: '#7E3A26',
        },
      },
      draft: {
        colorName: 'draft',
        lightColors: {
          main: '#7D7768',
          container: '#F5F4EF',
          onContainer: '#46413A',
        },
      },
      available: {
        colorName: 'available',
        lightColors: {
          main: '#3D7A5D',
          container: '#E3F0E8',
          onContainer: '#25543D',
        },
      },
    },
    callbacks: {
      onEventClick(event) {
        setExpandedDay(null)
        const eventId = String(event.id)
        if (eventId.startsWith(SLOT_EVENT_PREFIX)) {
          const slotId = eventId.slice(SLOT_EVENT_PREFIX.length)
          const slot = slotsRef.current.find((candidate) => candidate.id === slotId)
          if (slot) {
            setSelectedSession(null)
            setSelectedSlot(slot)
          }
          return
        }
        const session = sessionsRef.current.find((candidate) => candidate.id === event.id)
        if (session) {
          setSelectedSlot(null)
          setSelectedSession(session)
        }
      },
    },
    dayBoundaries: {
      start: '00:00',
      end: '24:00',
    },
    weekOptions: {
      gridHeight: 760,
      nDays: 7,
      eventWidth: 100,
    },
  }, [eventsService])

  useEffect(() => {
    sessionsRef.current = sessions
    slotsRef.current = slots
    eventsService.set([...sessionsToEvents(sessions), ...slotsToEvents(slots)])
  }, [eventsService, sessions, slots])

  useEffect(() => {
    const wrapper = calendarWrapperRef.current
    if (!wrapper) return

    function handleMoreEventsClick(nativeEvent: Event) {
      const target = nativeEvent.target as Element | null
      const button = target?.closest('.sx__month-grid-day__events-more')
      if (!button) return

      nativeEvent.preventDefault()
      nativeEvent.stopPropagation()
      if ('stopImmediatePropagation' in nativeEvent) {
        nativeEvent.stopImmediatePropagation()
      }

      const dayElement = button.closest('.sx__month-grid-day')
      const date = dayElement?.getAttribute('data-date')
      if (!date) return

      setSelectedSession(null)
      setExpandedDay({
        date,
        sessions: getSessionsForDate(sessionsRef.current, date),
        slots: getSlotsForDate(slotsRef.current, date),
        position: getExpandedDayPosition((button as HTMLElement).getBoundingClientRect()),
      })
    }

    wrapper.addEventListener('click', handleMoreEventsClick, true)
    return () => wrapper.removeEventListener('click', handleMoreEventsClick, true)
  }, [])

  useEffect(() => {
    if (!expandedDay) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setExpandedDay(null)
      }
    }

    function handleViewportChange() {
      setExpandedDay(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [expandedDay])

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(subscriptionUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const input = document.createElement('input')
      input.value = subscriptionUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-4">
      <div ref={calendarWrapperRef} className="sx-calendar-wrapper">
        {calendarApp && <ScheduleXCalendar calendarApp={calendarApp} />}
      </div>

      <div className="flex flex-col gap-3 border border-black bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span className="font-mono uppercase tracking-[0.2em] text-black">Calendar Feed</span>
          <span className="inline-flex items-center gap-2 font-mono">
            <span className="h-3 w-3 border border-red-700 bg-rose-100" />
            Published
          </span>
          <span className="inline-flex items-center gap-2 font-mono">
            <span className="h-3 w-3 border border-stone-600 bg-stone-100" />
            Draft / Cancelled
          </span>
          {slots.length > 0 && (
            <span className="inline-flex items-center gap-2 font-mono">
              <span className="h-3 w-3 border border-green-800 bg-green-100" />
              Available slot
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="font-mono text-xs text-gray-500">
            Subscribe in Google Calendar, Outlook, or Apple Calendar
          </span>
          <button
            onClick={handleCopyLink}
            className="border border-black bg-white px-3 py-2 font-mono text-xs text-black hover:bg-gray-50"
          >
            {copied ? 'Copied!' : 'Copy calendar link'}
          </button>
        </div>
      </div>

      {selectedSlot ? (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/15 px-4 py-6"
          onClick={() => setSelectedSlot(null)}
        >
          <div
            className="w-full max-w-sm border border-black bg-white shadow-[0_18px_60px_rgba(31,29,26,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-t-[6px] border-green-800 px-5 py-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <h3 className="text-xl font-mono font-bold leading-tight text-gray-800">
                  Open teaching slot
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedSlot(null)}
                  className="shrink-0 border border-black px-2 py-1 font-mono text-xs hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
              <div className="space-y-3 font-mono text-sm text-gray-700">
                <p>
                  {new Date(selectedSlot.date_start).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  <br />
                  {new Date(selectedSlot.date_start).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  –
                  {new Date(selectedSlot.date_end).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="text-xs text-gray-600">
                  This date is open for someone to claim and teach. If it has
                  been offered to you, claim it from the Teaching tab on your
                  dashboard before someone else does.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedSession ? (
        <div
          className="fixed inset-0 z-[220] flex items-start justify-end overflow-y-auto bg-black/15 px-4 py-6 sm:px-6"
          onClick={() => setSelectedSession(null)}
        >
          <div
            className="my-auto w-full max-w-md border border-black bg-white shadow-[0_18px_60px_rgba(31,29,26,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-t-[6px] border-red-700 px-5 py-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <h3 className="text-2xl font-mono font-bold leading-tight text-gray-800">
                  {selectedSession.title}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  className="shrink-0 border border-black px-2 py-1 font-mono text-xs hover:bg-gray-50"
                >
                  Close
                </button>
              </div>

              <div className="mb-5 flex flex-wrap gap-3">
                {/* Byte Meet joins go via the session page: the embedded room
                    there also records the member's self check-in. */}
                {selectedSession.location_type === 'JITSI' ? (
                  <button
                    type="button"
                    onClick={() => router.push(`/sessions/${selectedSession.id}`)}
                    className="border border-black bg-black px-4 py-3 font-mono text-sm text-white hover:bg-gray-800"
                  >
                    Join video room
                  </button>
                ) : sessionMeetingUrl(selectedSession) ? (
                  <a
                    href={sessionMeetingUrl(selectedSession)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border border-black bg-black px-4 py-3 font-mono text-sm text-white hover:bg-gray-800"
                  >
                    Join
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => router.push(`/sessions/${selectedSession.id}`)}
                  className="border border-black bg-white px-4 py-3 font-mono text-sm text-black hover:bg-gray-50"
                >
                  Open Session
                </button>
              </div>

              <div className="space-y-4 border-t border-gray-200 pt-5 font-mono text-sm text-gray-700">
                <div className="border-b border-gray-200 pb-4">
                  <p className="mb-1 text-xs uppercase tracking-[0.18em] text-gray-500">Time</p>
                  <p>{formatSessionDateRange(selectedSession)}</p>
                </div>

                <div className="border-b border-gray-200 pb-4">
                  <p className="mb-1 text-xs uppercase tracking-[0.18em] text-gray-500">Location</p>
                  <p>{getLocationLabel(selectedSession)}</p>
                  {sessionMeetingUrl(selectedSession) ? (
                    <a
                      href={sessionMeetingUrl(selectedSession)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs underline"
                    >
                      Open meeting link
                    </a>
                  ) : null}
                </div>

                <div className="border-b border-gray-200 pb-4">
                  <p className="mb-1 text-xs uppercase tracking-[0.18em] text-gray-500">Status</p>
                  <p>{selectedSession.status}</p>
                </div>

                {selectedSession.description ? (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-[0.18em] text-gray-500">Details</p>
                    <p className="leading-relaxed">{selectedSession.description}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {expandedDay ? (
        <div
          className="fixed inset-0 z-[210] bg-black/10"
          onClick={() => setExpandedDay(null)}
        >
          <div
            className="absolute"
            style={{
              top: expandedDay.position.top,
              left: expandedDay.position.left,
              width: expandedDay.position.width,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="absolute h-4 w-4 rotate-45 border border-black bg-white"
              style={{
                top: expandedDay.position.arrowTop,
                [expandedDay.position.arrowSide]: -8,
              }}
            />

            <div
              className="relative overflow-hidden border border-black bg-white shadow-[8px_8px_0_rgba(31,29,26,0.08)]"
              style={{ maxHeight: expandedDay.position.maxHeight }}
            >
              <div className="border-b border-black px-4 py-4 sm:px-5">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="truncate font-mono text-xl font-bold tracking-[-0.06em] text-black sm:text-3xl">
                    {formatDayHeading(expandedDay.date)}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setExpandedDay(null)}
                    className="shrink-0 border border-black bg-white px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-black hover:bg-gray-50"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="max-h-[min(70vh,34rem)] overflow-y-auto">
                {expandedDay.slots.map((slot, index) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => {
                      setExpandedDay(null)
                      setSelectedSession(null)
                      setSelectedSlot(slot)
                    }}
                    className={`flex w-full items-start gap-4 px-4 py-4 text-left font-mono transition hover:bg-gray-50 sm:px-5 ${
                      index > 0 ? 'border-t border-black' : ''
                    }`}
                  >
                    <div
                      className="mt-0.5 h-[4.6rem] w-2 shrink-0 border border-black"
                      style={{ backgroundColor: '#3D7A5D' }}
                    />
                    <div className="w-20 shrink-0 pt-0.5 text-gray-700">
                      <p className="text-lg font-bold leading-none text-black">
                        {formatTimeHM(slot.date_start)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="truncate text-lg font-bold leading-tight text-black">
                        Available — open slot
                      </p>
                      <p className="mt-1 text-xs text-gray-600">Claimable teaching slot</p>
                    </div>
                  </button>
                ))}
                {expandedDay.sessions.map((session, index) => {
                  const isStriped = session.status !== 'PUBLISHED'

                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => {
                        setExpandedDay(null)
                        setSelectedSession(session)
                      }}
                      className={`flex w-full items-start gap-4 px-4 py-4 text-left font-mono transition hover:bg-gray-50 sm:px-5 ${
                        index > 0 || expandedDay.slots.length > 0 ? 'border-t border-black' : ''
                      }`}
                    >
                      <div
                        className="mt-0.5 h-[4.6rem] w-2 shrink-0 border border-black"
                        style={isStriped
                          ? {
                              backgroundImage:
                                'repeating-linear-gradient(-45deg, #1F1D1A 0, #1F1D1A 4px, #FAF9F5 4px, #FAF9F5 8px)',
                            }
                          : { backgroundColor: '#C25D3D' }}
                      />

                      <div className="w-20 shrink-0 pt-0.5 text-gray-700">
                        <p className="text-lg font-bold leading-none text-black">
                          {formatSessionStart(session)}
                        </p>
                        <p className="mt-2 text-[10px] uppercase tracking-[0.18em] leading-none text-gray-500">
                          {formatSessionDuration(session)}
                        </p>
                      </div>

                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="truncate text-lg font-bold leading-tight text-black">
                          {getCalendarEventTitle(session)}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-500">
                          <span className="truncate">{getLocationLabel(session)}</span>
                          {sessionMeetingUrl(session) ? <span className="shrink-0">↗</span> : null}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
