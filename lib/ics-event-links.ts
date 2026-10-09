import { sessionMeetingUrl } from '@/lib/jitsi'
import type { MeetingConfig } from '@/lib/meeting/types'
import type { LocationType } from '@/lib/types'

export interface IcsEventLinks {
  /** VEVENT LOCATION; undefined when there is nothing to show. */
  location: string | undefined
  /** VEVENT URL; set for Petrios Meet sessions so calendar apps show a clickable room link. */
  url: string | undefined
}

/**
 * LOCATION/URL for one session in the org ICS feed (spec/04 "Calendar
 * subscription"). The feed is subscribed to by organisation members, so links
 * resolve for the member audience: a token-protected room (JaaS, self-hosted
 * JWT) resolves to the Petrios session page, where the member gets a room
 * pass; public meet.jit.si and open self-hosted rooms keep their raw room URL.
 */
export function icsEventLinks(
  session: { id: string; location_type: LocationType | string; teams_meeting_url: string | null },
  config?: MeetingConfig,
): IcsEventLinks {
  const meetingUrl = sessionMeetingUrl(session, { kind: 'member' }, config)
  const parts: string[] = []
  if (session.location_type === 'MS_TEAMS' || session.location_type === 'HYBRID') {
    parts.push(meetingUrl || 'Microsoft Teams')
  }
  if (session.location_type === 'IN_PERSON' || session.location_type === 'HYBRID') {
    parts.push('In Person')
  }
  if (session.location_type === 'JITSI') {
    parts.push(meetingUrl || 'Petrios Meet (Video)')
  }
  return {
    location: parts.join(' / ') || undefined,
    url: session.location_type === 'JITSI' && meetingUrl ? meetingUrl : undefined,
  }
}
