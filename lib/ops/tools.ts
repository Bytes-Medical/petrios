import { z } from 'zod'
import * as opsDb from '@/lib/db/ops'
import * as opsReads from '@/lib/db/ops-reads'
import * as auditDb from '@/lib/db/audit'
import * as teachingSlotsDb from '@/lib/db/teaching-slots'
import * as onboardingDb from '@/lib/db/onboarding'
import { buildOpsEmailHtml } from './email-html'
import { averageRating } from './format'
import type { OpsRun } from './run'

/**
 * The assistant's tool registry. Design rules (from the Petrios Ops spec):
 *   - org scope comes from the AUTHENTICATED caller's context, never from
 *     model input — a tool argument can never reach outside the org
 *   - read tools cap output at 20 rows
 *   - comms_propose_email is the ONLY write that leads towards an email, and
 *     all it does is queue a pending action for human approval
 *   - no tool exposes per-trainee performance data
 */

export interface ToolContext {
  orgId: string
  userId: string
  run: OpsRun
}

export interface OpsTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (ctx: ToolContext, input: unknown) => Promise<unknown>
}

const ROW_CAP = 20

const NO_INPUT: Record<string, unknown> = { type: 'object', properties: {}, additionalProperties: false }

const sessionIdInput = {
  type: 'object',
  properties: { sessionId: { type: 'string', description: 'Session id (UUID)' } },
  required: ['sessionId'],
  additionalProperties: false,
}

const SessionIdSchema = z.object({ sessionId: z.string().uuid() })

function sessionSummaryLine(s: opsReads.OpsSessionRow) {
  return {
    id: s.id,
    title: s.title,
    date_start: s.date_start,
    location_type: s.location_type,
    session_type: s.session_type,
  }
}

export const OPS_TOOLS: OpsTool[] = [
  {
    name: 'sessions_list_upcoming',
    description:
      'List published upcoming sessions for this organisation (next N days, default 30). Use for "what is coming up".',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Look-ahead window in days (1-120)' } },
      additionalProperties: false,
    },
    handler: async (ctx, input) => {
      const { days } = z.object({ days: z.number().min(1).max(120).optional() }).parse(input ?? {})
      const sessions = await opsReads.listUpcomingSessionsForOrg(ctx.orgId, days ?? 30, ROW_CAP)
      return sessions.map(sessionSummaryLine)
    },
  },
  {
    name: 'sessions_get',
    description:
      'Get one session in detail: description, times, and the accept/decline status of every invited teacher (registered and external).',
    inputSchema: sessionIdInput,
    handler: async (ctx, input) => {
      const { sessionId } = SessionIdSchema.parse(input)
      const session = await opsReads.findSessionInOrg(sessionId, ctx.orgId)
      if (!session) return { error: 'Session not found in this organisation' }

      const [teachers, invitations] = await Promise.all([
        opsReads.listTeachersForSessions([sessionId]),
        opsReads.listInvitationsForSessions([sessionId]),
      ])
      const profiles = await onboardingDb.listProfilesForUsers(teachers.map((t) => t.user_id))
      return {
        ...session,
        teachers: teachers.map((t) => ({
          name:
            profiles.find((p) => p.user_id === t.user_id)?.full_name ?? 'Registered member',
          status: t.status,
          registered: true,
        })),
        external_invitations: invitations.map((i) => ({
          name: [i.first_name, i.last_name].filter(Boolean).join(' ') || i.email,
          status: i.status,
          registered: false,
        })),
      }
    },
  },
  {
    name: 'sessions_list_unconfirmed_speakers',
    description:
      'List upcoming sessions (next 30 days) where NO teacher has accepted yet, with who is still pending. Use for "which sessions still need a speaker".',
    inputSchema: NO_INPUT,
    handler: async (ctx) => {
      const sessions = await opsReads.listUpcomingSessionsForOrg(ctx.orgId, 30, 50)
      const ids = sessions.map((s) => s.id)
      const [teachers, invitations] = await Promise.all([
        opsReads.listTeachersForSessions(ids),
        opsReads.listInvitationsForSessions(ids),
      ])
      const result = []
      for (const session of sessions) {
        const st = teachers.filter((t) => t.session_id === session.id)
        const si = invitations.filter((i) => i.session_id === session.id)
        const accepted =
          st.some((t) => t.status === 'ACCEPTED') || si.some((i) => i.status === 'ACCEPTED')
        if (accepted) continue
        result.push({
          ...sessionSummaryLine(session),
          pending_registered_teachers: st.filter((t) => t.status === 'PENDING').length,
          pending_external_invitations: si
            .filter((i) => i.status === 'PENDING')
            .map((i) => [i.first_name, i.last_name].filter(Boolean).join(' ') || i.email),
        })
        if (result.length >= ROW_CAP) break
      }
      return result
    },
  },
  {
    name: 'feedback_stats_for_session',
    description:
      'Aggregate feedback stats for one session: response count, average rating, rating distribution. (For themes and quotes use synthesis_get_for_session.)',
    inputSchema: sessionIdInput,
    handler: async (ctx, input) => {
      const { sessionId } = SessionIdSchema.parse(input)
      const ratings = (await auditDb.listFeedbackRatingsForSessions([sessionId]))
        .filter((r) => r.rating !== null)
        .map((r) => r.rating as number)
      if (ratings.length === 0) return { responses: 0 }
      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      for (const rating of ratings) distribution[rating] = (distribution[rating] ?? 0) + 1
      return {
        responses: ratings.length,
        average: averageRating(ratings),
        distribution,
      }
    },
  },
  {
    name: 'feedback_low_scoring',
    description:
      'List sessions from the last N days (default 90) with at least 3 responses and an average rating below 3.5.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Look-back window in days (1-365)' } },
      additionalProperties: false,
    },
    handler: async (ctx, input) => {
      const { days } = z.object({ days: z.number().min(1).max(365).optional() }).parse(input ?? {})
      const windowStart = new Date(Date.now() - (days ?? 90) * 24 * 60 * 60 * 1000).toISOString()
      const sessions = await opsReads.listSessionsEndedInWindow(
        ctx.orgId,
        windowStart,
        new Date().toISOString(),
        100
      )
      const ratings = await auditDb.listFeedbackRatingsForSessions(sessions.map((s) => s.id))
      const low = []
      for (const session of sessions) {
        const rs = ratings
          .filter((r) => r.session_id === session.id && r.rating !== null)
          .map((r) => r.rating as number)
        if (rs.length < 3) continue
        const avg = rs.reduce((a, b) => a + b, 0) / rs.length
        if (avg < 3.5) {
          low.push({ ...sessionSummaryLine(session), average: averageRating(rs), responses: rs.length })
          if (low.length >= ROW_CAP) break
        }
      }
      return low
    },
  },
  {
    name: 'synthesis_get_for_session',
    description:
      'Get the stored privacy-processed feedback synthesis for a session: themes, sentiment, suggestions, quotes. Returns a review flag instead when the feedback needs human eyes.',
    inputSchema: sessionIdInput,
    handler: async (_ctx, input) => {
      const { sessionId } = SessionIdSchema.parse(input)
      const synthesis = await opsDb.findSynthesisForSession(sessionId)
      if (!synthesis) return { error: 'No synthesis stored for this session yet' }
      if (synthesis.requires_human_review) {
        return {
          requires_human_review: true,
          note: 'This feedback was flagged for human review (possible welfare/conduct content). The organiser should read the raw feedback on the session page — do not summarise it.',
        }
      }
      return {
        themes: synthesis.themes,
        sentiment: synthesis.sentiment,
        suggestions: synthesis.suggestions,
        quotes: synthesis.quotes,
        response_count: synthesis.response_count,
        average_rating: synthesis.average_rating,
      }
    },
  },
  {
    name: 'attendance_summary_for_session',
    description:
      'Attendance COUNTS for one session (present/late/absent totals). Aggregate only — individual attendance is out of scope.',
    inputSchema: sessionIdInput,
    handler: async (_ctx, input) => {
      const { sessionId } = SessionIdSchema.parse(input)
      const rows = await auditDb.listAttendanceStatusesForSessions([sessionId])
      const counts: Record<string, number> = {}
      for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1
      return { total: rows.length, by_status: counts }
    },
  },
  {
    name: 'slots_list_open',
    description: 'List currently open (unclaimed) teaching slots in this organisation.',
    inputSchema: NO_INPUT,
    handler: async (ctx) => {
      const slots = await teachingSlotsDb.listActiveSlotsForOrg(ctx.orgId)
      return slots.slice(0, ROW_CAP)
    },
  },
  {
    name: 'memory_list',
    description:
      'List saved organiser notes/preferences (e.g. "prefers Tuesday lunchtime slots"). Check before assuming preferences.',
    inputSchema: NO_INPUT,
    handler: async (ctx) => {
      const entries = await opsDb.listMemory(ctx.orgId, ROW_CAP)
      return entries.map((e) => ({ key: e.key, value: e.value, updated_at: e.updated_at }))
    },
  },
  {
    name: 'memory_save',
    description:
      'Save a durable note/preference for this organisation (upserts by key). Use short kebab-case keys.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short kebab-case key' },
        value: { type: 'string', description: 'The note to remember' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    handler: async (ctx, input) => {
      const { key, value } = z
        .object({ key: z.string().min(1).max(100), value: z.string().min(1).max(2000) })
        .parse(input)
      await opsDb.upsertMemory({
        orgId: ctx.orgId,
        key,
        value,
        source: 'assistant',
        createdBy: ctx.userId,
      })
      return { saved: true, key }
    },
  },
  {
    name: 'comms_propose_email',
    description:
      'DRAFT an email into the human approval queue. It is NOT sent — an organiser must approve it on the Ops page first. Body is plain text.',
    inputSchema: {
      type: 'object',
      properties: {
        to_email: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text body' },
      },
      required: ['to_email', 'subject', 'body'],
      additionalProperties: false,
    },
    handler: async (ctx, input) => {
      const parsed = z
        .object({
          to_email: z.string().email(),
          subject: z.string().min(1).max(150),
          body: z.string().min(1).max(5000),
        })
        .parse(input)
      const action = await opsDb.insertPendingAction({
        orgId: ctx.orgId,
        type: 'CUSTOM_EMAIL',
        payload: {
          email: parsed.to_email,
          subject: parsed.subject,
          html: buildOpsEmailHtml({ heading: parsed.subject, bodyText: parsed.body }),
        },
        previewTitle: `Email ${parsed.to_email}: ${parsed.subject}`,
        previewBody: `To: ${parsed.to_email}\nSubject: ${parsed.subject}\n\n${parsed.body}`,
        createdBy: ctx.userId,
      })
      return {
        queued_for_approval: true,
        action_id: action.id,
        note: 'The email is waiting in the approval queue (/ops). It will only send once an organiser approves it.',
      }
    },
  },
]
