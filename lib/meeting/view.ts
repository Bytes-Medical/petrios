import { isFallbackMeetingDisplayName } from '@/lib/contacts'
import { MEETING_MESSAGES } from './access'
import { getMeetingConfig } from './config'
import { meetingRoomSlug } from './location'
import type { MeetingConfig, MeetingRoomView } from './types'
import { meetingRoomWindow } from './window'

/**
 * Server-side view model for the meeting panel. Carries no secret and no
 * configuration-error detail (the generic `unavailableMessage` only; the
 * moderator-only manage page shows the detail). Server components build it
 * and hand it to the client panel, which never resolves the mode itself.
 */
export function buildMeetingRoomView(input: {
  session: {
    id: string
    title: string
    status: string
    location_type: string
    date_start: string
    date_end: string
  }
  displayName: string
  /** Department moderator or ACCEPTED teacher (server-computed). Default false. */
  viewerIsModerator?: boolean
  now?: Date
  config?: MeetingConfig
}): MeetingRoomView {
  const config = input.config ?? getMeetingConfig()
  const now = input.now ?? new Date()
  const { session } = input
  const { opensAt, closesAt } = meetingRoomWindow(session)

  const availability: MeetingRoomView['availability'] = !config.ok
    ? 'unavailable'
    : session.status === 'CANCELLED'
      ? 'cancelled'
      : session.status !== 'PUBLISHED'
        ? 'not_published'
        : 'ready'

  const mode = config.ok ? config.mode : 'unavailable'
  return {
    sessionId: session.id,
    sessionTitle: session.title,
    mode,
    embedded: mode === 'jaas' || mode === 'self-hosted',
    availability,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
    serverNow: now.toISOString(),
    publicRoomUrl:
      config.ok && config.mode === 'public' ? `${config.origin}/${meetingRoomSlug(session.id)}` : null,
    displayName: input.displayName,
    displayNameIsFallback: isFallbackMeetingDisplayName(input.displayName),
    viewerIsModerator: input.viewerIsModerator ?? false,
    unavailableMessage: availability === 'unavailable' ? MEETING_MESSAGES.unavailable : null,
  }
}
