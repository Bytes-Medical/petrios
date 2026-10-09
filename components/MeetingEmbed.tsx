'use client'

import { Component, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import type { IJitsiMeetExternalApi } from '@jitsi/react-sdk/lib/types'
import type { MeetingJoin } from '@/lib/meeting/types'
import { buildEmbedConfig, meetingIframeTitle } from '@/lib/meeting/embed-config'
import { startLoadWatchdog, wireMeetingEvents } from '@/lib/meeting/embed-events'

function EmbedLoading() {
  return (
    <p className="p-4 font-mono text-sm text-gray-100">Loading the video room…</p>
  )
}

// The SDK injects the provider's external_api.js into the page, so it can
// only ever render client-side.
const JitsiMeeting = dynamic(
  () => import('@jitsi/react-sdk').then((m) => m.JitsiMeeting),
  { ssr: false, loading: EmbedLoading }
)

/**
 * Keeps a failed SDK chunk load, or an error thrown while the SDK builds its
 * iframe, inside the room panel instead of replacing the whole page with the
 * route error boundary.
 */
class EmbedErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export interface MeetingEmbedProps {
  join: MeetingJoin
  sessionTitle: string
  /** The local participant entered the conference (past the prejoin screen). */
  onJoined(): void
  /** Hung up / closed the room. */
  onLeft(): void
  /** The provider reported a fatal error (connection, expired or refused pass). */
  onFatalError(message: string): void
  /**
   * The SDK chunk or the provider's external_api.js failed to load, or never
   * handed over the API in time (blocked or offline).
   */
  onLoadFailed(): void
}

/**
 * One embedded Petrios Meet room (JaaS or self-hosted Jitsi) via
 * @jitsi/react-sdk 1.4.4. Mount it with a NEW React key for every room pass:
 * the SDK builds its iframe once per mount and ignores later prop changes.
 *
 * SDK quirks handled here (design F12): it never disposes the External API
 * on unmount (we do), it never surfaces a failed script load (a watchdog
 * reports it; an error boundary catches a failed chunk), and it hands
 * getIFrameRef the parent div, not the iframe.
 */
export function MeetingEmbed(props: MeetingEmbedProps) {
  const { join, sessionTitle } = props

  // Event listeners are attached once per mount; route them through a ref
  // so they always call the latest callbacks.
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  const apiRef = useRef<IJitsiMeetExternalApi | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const teardownEventsRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // Move focus to the room so keyboard and screen-reader users land in it.
    containerRef.current?.focus()
    const cancelWatchdog = startLoadWatchdog(
      () => apiRef.current !== null,
      () => latest.current.onLoadFailed()
    )

    return () => {
      cancelWatchdog()
      // Cancel a pending leave and ignore late events before disposing.
      teardownEventsRef.current?.()
      teardownEventsRef.current = null
      const api = apiRef.current
      apiRef.current = null
      if (api) {
        try {
          // Removes listeners and the iframe, ending this participant's call.
          api.dispose()
        } catch {
          // The iframe is going away with this component either way.
        }
      }
    }
  }, [])

  const handleApiReady = useCallback((api: IJitsiMeetExternalApi) => {
    apiRef.current = api
    try {
      api.getIFrame().setAttribute('title', meetingIframeTitle(latest.current.sessionTitle))
    } catch {
      // Title is best-effort; the surrounding region is labelled too.
    }
    // Lifecycle logic lives in lib/meeting/embed-events.ts (unit-tested).
    teardownEventsRef.current?.()
    teardownEventsRef.current = wireMeetingEvents(api, {
      onJoined: () => latest.current.onJoined(),
      onLeft: () => latest.current.onLeft(),
      onFatalError: (name) => latest.current.onFatalError(name),
    })
  }, [])

  const sizeParent = useCallback((parent: HTMLDivElement) => {
    // react-sdk passes the iframe's parent div; the iframe fills it at 100%.
    parent.style.height = '100%'
    parent.style.width = '100%'
  }, [])

  const tokenMode = join.jwt !== null
  const configOverwrite = useMemo(
    () => buildEmbedConfig(sessionTitle, { lockDisplayName: tokenMode }),
    [sessionTitle, tokenMode]
  )
  const reportLoadFailed = useCallback(() => latest.current.onLoadFailed(), [])
  // Token modes take the name from the room pass; open rooms need it here.
  const userInfo = useMemo(
    () => (tokenMode ? undefined : { displayName: join.displayName, email: '' }),
    [tokenMode, join.displayName]
  )

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="region"
      aria-label={meetingIframeTitle(sessionTitle)}
      className="w-full overflow-hidden border border-black bg-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-clay-600 focus-visible:ring-offset-2"
      style={{ height: 'min(75vh, 680px)', minHeight: 'min(420px, 92vh)' }}
    >
      <EmbedErrorBoundary onError={reportLoadFailed}>
        <JitsiMeeting
          domain={join.domain}
          roomName={join.roomName}
          jwt={join.jwt ?? undefined}
          userInfo={userInfo}
          configOverwrite={configOverwrite}
          spinner={EmbedLoading}
          onApiReady={handleApiReady}
          getIFrameRef={sizeParent}
        />
      </EmbedErrorBoundary>
    </div>
  )
}
