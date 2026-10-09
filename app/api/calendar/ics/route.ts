import { NextRequest, NextResponse } from 'next/server'
import ical, { ICalCalendarMethod, ICalEventStatus } from 'ical-generator'
import { icsEventLinks } from '@/lib/ics-event-links'
import { getMeetingConfig } from '@/lib/meeting/config'
import * as sessionsDb from '@/lib/db/sessions'
import * as organizationsDb from '@/lib/db/organizations'

function computeToken(orgId: string): string {
  // Simple deterministic token: hex-encoded hash of orgId + server secret
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  let hash = 0
  const str = orgId + secret
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const orgId = searchParams.get('orgId')
  const token = searchParams.get('token')
  const departmentId = searchParams.get('departmentId') || undefined

  if (!orgId || !token) {
    return NextResponse.json({ error: 'Missing orgId or token' }, { status: 400 })
  }

  const expectedToken = computeToken(orgId)
  if (token !== expectedToken) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
  }

  const orgName = await organizationsDb.findOrganizationNamePublic(orgId)
  const sessions = await sessionsDb.listPublishedSessionsForOrgPublic(orgId, departmentId)

  const calendar = ical({
    name: orgName ? `${orgName} Teaching Sessions` : 'Teaching Sessions',
    method: ICalCalendarMethod.PUBLISH,
    prodId: { company: 'Petrios', product: 'Dashboard' },
    ttl: 3600,
  })

  // Resolve the meeting configuration once per feed, not once per event.
  const meetingConfig = getMeetingConfig()

  for (const session of sessions) {
    const { location, url } = icsEventLinks(session, meetingConfig)

    calendar.createEvent({
      id: session.id,
      start: new Date(session.date_start),
      end: new Date(session.date_end),
      summary: session.title,
      description: session.description || undefined,
      location,
      url,
      status: ICalEventStatus.CONFIRMED,
    })
  }

  const icsContent = calendar.toString()

  return new NextResponse(icsContent, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sessions.ics"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
