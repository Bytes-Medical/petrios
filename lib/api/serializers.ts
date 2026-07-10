import type { Session } from '@/lib/types'
import { sessionMeetingUrl } from '@/lib/jitsi'

/**
 * Stable public JSON shapes for /api/v1. Only fields listed here are part of
 * the API contract (public/openapi.json) — adding is fine, removing/renaming
 * is a breaking change requiring a new API version.
 */
export function serializeSession(session: Session) {
  return {
    id: session.id,
    department_id: session.department_id,
    title: session.title,
    description: session.description,
    date_start: session.date_start,
    date_end: session.date_end,
    location_type: session.location_type,
    meeting_url: sessionMeetingUrl(session),
    status: session.status,
    session_type: session.session_type,
    created_at: session.created_at,
    updated_at: session.updated_at,
  }
}
