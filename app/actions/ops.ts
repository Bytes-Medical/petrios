'use server'

import { revalidatePath } from 'next/cache'
import { requireOpsManager } from '@/lib/ops/auth'
import {
  isOrgAdmin,
  isSuperAdmin,
  requireDepartmentModerator,
} from '@/lib/auth'
import { opsEnabled } from '@/lib/ops/flags'
import { executeAction } from '@/lib/ops/executors'
import { startRun } from '@/lib/ops/run'
import { generateDepartmentNewsletter } from '@/lib/ops/newsletter-job'
import {
  buildNewsletterHtml,
  newsletterPreviewText,
  newsletterSchemaForSessions,
  newsletterWindowFromWeekStart,
} from '@/lib/ops/newsletter'
import { formatDateLong } from '@/lib/ops/format'
import * as opsDb from '@/lib/db/ops'
import * as opsReads from '@/lib/db/ops-reads'
import * as departmentsDb from '@/lib/db/departments'
import * as organizationsDb from '@/lib/db/organizations'
import type {
  OpsAgentRun,
  OpsAgentRunStep,
  OpsNewsletterContent,
  OpsNewsletterIssue,
  OpsPendingAction,
} from '@/lib/types'

/**
 * Petrios Ops server actions — every entry point re-checks requireOpsManager
 * (organisers only) and scopes to the caller's org. The ops_* tables are
 * deny-all RLS, so these actions are the only interactive path to them.
 */

export interface OpsOverview {
  enabled: boolean
  pending: OpsPendingAction[]
  reviewed: OpsPendingAction[]
}

async function newsletterDepartments(userId: string, orgId: string) {
  const elevated = (await isOrgAdmin(orgId)) || (await isSuperAdmin())
  return elevated
    ? departmentsDb.listDepartmentsByOrg(orgId)
    : departmentsDb.listModeratedDepartments(userId, orgId)
}

async function requireActionScope(action: OpsPendingAction, orgId: string): Promise<void> {
  if (action.department_id) {
    await requireDepartmentModerator(action.department_id)
    return
  }
  if (!(await isOrgAdmin(orgId)) && !(await isSuperAdmin())) {
    throw new Error('Organization administrator required for this action')
  }
}

export async function getOpsOverview(): Promise<OpsOverview> {
  const { userId, orgId } = await requireOpsManager()
  const [pending, reviewed] = await Promise.all([
    opsDb.listPendingActions(orgId, { statuses: ['pending'] }),
    opsDb.listPendingActions(orgId, {
      statuses: ['approved', 'executed', 'rejected', 'failed'],
      limit: 15,
    }),
  ])
  const elevated = (await isOrgAdmin(orgId)) || (await isSuperAdmin())
  if (elevated) return { enabled: opsEnabled(), pending, reviewed }
  const departmentIds = new Set(
    (await departmentsDb.listModeratedDepartments(userId, orgId)).map((department) => department.id)
  )
  return {
    enabled: opsEnabled(),
    pending: pending.filter((action) => action.department_id && departmentIds.has(action.department_id)),
    reviewed: reviewed.filter((action) => action.department_id && departmentIds.has(action.department_id)),
  }
}

export async function approveOpsAction(actionId: string): Promise<{ success: true }> {
  const { userId, orgId } = await requireOpsManager()
  if (!opsEnabled()) {
    throw new Error('Petrios Ops is disabled (OPS_ENABLED=false) — actions cannot be executed.')
  }

  const current = await opsDb.findPendingAction(actionId, orgId)
  if (!current) throw new Error('Action not found')
  await requireActionScope(current, orgId)

  // Compare-and-set claim: null means someone else already reviewed it.
  const action = await opsDb.approvePendingAction(actionId, orgId, userId)
  if (!action) {
    throw new Error('This action has already been reviewed.')
  }

  try {
    await executeAction(action)
    await opsDb.markActionExecuted(action.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Execution failed'
    await opsDb.markActionFailed(action.id, message)
    throw new Error(`Approved, but execution failed: ${message}`)
  }

  revalidatePath('/ops')
  return { success: true }
}

export async function rejectOpsAction(actionId: string): Promise<{ success: true }> {
  const { userId, orgId } = await requireOpsManager()

  const current = await opsDb.findPendingAction(actionId, orgId)
  if (!current) throw new Error('Action not found')
  await requireActionScope(current, orgId)

  const rejected = await opsDb.rejectPendingAction(actionId, orgId, userId)
  if (!rejected) {
    throw new Error('This action has already been reviewed.')
  }

  revalidatePath('/ops')
  return { success: true }
}

export async function getOpsRunSteps(runId: string): Promise<OpsAgentRunStep[]> {
  const { orgId } = await requireOpsManager()

  const run = await opsDb.findAgentRun(runId)
  if (!run || (run.org_id !== null && run.org_id !== orgId)) {
    throw new Error('Run not found')
  }
  return opsDb.listRunSteps(runId)
}

export async function getNewsletterIssues(): Promise<OpsNewsletterIssue[]> {
  const { userId, orgId } = await requireOpsManager()
  const departments = await newsletterDepartments(userId, orgId)
  return opsDb.listNewsletterIssues(orgId, departments.map((department) => department.id))
}

export interface NewsletterWorkspace {
  departments: { id: string; name: string; memberCount: number }[]
  issues: OpsNewsletterIssue[]
}

export async function getNewsletterWorkspace(): Promise<NewsletterWorkspace> {
  const { userId, orgId } = await requireOpsManager()
  const departments = await newsletterDepartments(userId, orgId)
  const [issues, memberCounts] = await Promise.all([
    opsDb.listNewsletterIssues(orgId, departments.map((department) => department.id)),
    Promise.all(departments.map((department) => departmentsDb.countDepartmentMembers(department.id))),
  ])
  return {
    departments: departments.map((department, index) => ({
      id: department.id,
      name: department.name,
      memberCount: memberCounts[index],
    })),
    issues,
  }
}

function newsletterSummaryPoints(content: OpsNewsletterContent) {
  return content.sessions.map((session) => ({
    title: session.title,
    detail: session.overview,
  }))
}

export async function generateWeeklyNewsletter(
  departmentId: string,
  weekStartKey: string
): Promise<{ issueId: string }> {
  const { userId, orgId } = await requireOpsManager()
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled (OPS_ENABLED=false).')
  await requireDepartmentModerator(departmentId)
  const department = await departmentsDb.findDepartment(departmentId, orgId)
  if (!department) throw new Error('Department not found')
  const window = newsletterWindowFromWeekStart(weekStartKey)
  const existing = await opsDb.findNewsletterIssue(orgId, departmentId, window.weekStartKey)
  if (existing && (existing.status === 'sent' || existing.sent_count > 0)) {
    throw new Error('This department newsletter has already been emailed')
  }

  const run = await startRun('ops_newsletter', 'manual', orgId)
  try {
    const sessions = await opsReads.listDepartmentSessionsEndedInWindow(
      orgId,
      departmentId,
      window.weekStart.toISOString(),
      window.weekEnd.toISOString(),
      51
    )
    if (sessions.length === 0) throw new Error('No published teaching ended in this department during that week')
    if (sessions.length > 50) throw new Error('This week contains more than 50 sessions and cannot fit a one-page digest')

    const generated = await generateDepartmentNewsletter({
      departmentName: department.name,
      sessions,
      run,
    })
    const organizationName = (await organizationsDb.findOrganizationName(orgId)) ?? 'Petrios'
    const weekLabel = `Week commencing ${formatDateLong(window.weekStart.toISOString())}`
    const html = buildNewsletterHtml({
      organizationName,
      departmentName: department.name,
      weekLabel,
      content: generated.content,
    })
    const issue = existing
      ? await opsDb.replaceNewsletterDraft({
          id: existing.id,
          orgId,
          departmentId,
          generatedBy: userId,
          subject: generated.content.subject,
          html,
          summaryPoints: newsletterSummaryPoints(generated.content),
          content: generated.content,
          sourceSessionIds: sessions.map((session) => session.id),
          sourceDocuments: generated.sourceDocuments,
        })
      : await opsDb.insertNewsletterIssue({
          orgId,
          departmentId,
          weekStart: window.weekStartKey,
          generatedBy: userId,
          subject: generated.content.subject,
          html,
          summaryPoints: newsletterSummaryPoints(generated.content),
          content: generated.content,
          sourceSessionIds: sessions.map((session) => session.id),
          sourceDocuments: generated.sourceDocuments,
        })

    if (existing) await opsDb.deleteUnsentNewsletterDeliveries(existing.id)

    await run.finish('succeeded', `Drafted ${department.name} newsletter from ${sessions.length} session(s) and ${generated.sourceDocuments.length} document(s)`)
    revalidatePath('/ops/newsletters')
    return { issueId: issue.id }
  } catch (err) {
    await run.finish('failed', err instanceof Error ? err.message : 'newsletter generation failed')
    throw err
  }
}

async function requireNewsletterIssue(issueId: string) {
  const { userId, orgId } = await requireOpsManager()
  const issue = await opsDb.findNewsletterIssueById(issueId)
  if (!issue || issue.org_id !== orgId || !issue.department_id) throw new Error('Newsletter not found')
  await requireDepartmentModerator(issue.department_id)
  const department = await departmentsDb.findDepartment(issue.department_id, orgId)
  if (!department) throw new Error('Department not found')
  return { userId, orgId, issue, department }
}

async function saveNewsletterContent(input: {
  issueId: string
  content: OpsNewsletterContent
  expectedRevision: number
}) {
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled (OPS_ENABLED=false).')
  const scope = await requireNewsletterIssue(input.issueId)
  if (!scope.issue.content) throw new Error('This legacy newsletter cannot be edited')
  if (scope.issue.sent_count > 0) throw new Error('A partially delivered newsletter can no longer be edited')
  const trustedSections = new Map(
    scope.issue.content.sessions.map((section) => [section.session_id, section])
  )
  const normalizedContent: OpsNewsletterContent = {
    ...input.content,
    sessions: input.content.sessions.map((section) => {
      const trusted = trustedSections.get(section.session_id)
      return trusted
        ? { ...section, title: trusted.title, date_label: trusted.date_label }
        : section
    }),
  }
  const parsed = newsletterSchemaForSessions(scope.issue.source_session_ids).safeParse(normalizedContent)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Newsletter content is invalid')
  const organizationName = (await organizationsDb.findOrganizationName(scope.orgId)) ?? 'Petrios'
  const weekLabel = `Week commencing ${formatDateLong(`${scope.issue.week_start}T00:00:00.000Z`)}`
  const issue = await opsDb.saveNewsletterDraft({
    id: scope.issue.id,
    orgId: scope.orgId,
    departmentId: scope.issue.department_id!,
    subject: parsed.data.subject,
    html: buildNewsletterHtml({
      organizationName,
      departmentName: scope.department.name,
      weekLabel,
      content: parsed.data,
    }),
    summaryPoints: newsletterSummaryPoints(parsed.data),
    content: parsed.data,
    expectedRevision: input.expectedRevision,
  })
  await opsDb.deleteUnsentNewsletterDeliveries(scope.issue.id)
  return { ...scope, issue }
}

export async function saveWeeklyNewsletter(
  issueId: string,
  content: OpsNewsletterContent,
  expectedRevision: number
): Promise<{ revision: number }> {
  const { issue } = await saveNewsletterContent({ issueId, content, expectedRevision })
  revalidatePath('/ops/newsletters')
  return { revision: issue.content_revision }
}

async function executeReviewedNewsletter(scope: Awaited<ReturnType<typeof requireNewsletterIssue>>) {
  const action = await opsDb.insertPendingAction({
    orgId: scope.orgId,
    departmentId: scope.issue.department_id,
    type: 'NEWSLETTER_ISSUE',
    payload: { issueId: scope.issue.id, contentRevision: scope.issue.content_revision },
    previewTitle: `Department newsletter: ${scope.issue.subject}`,
    previewBody: newsletterPreviewText(scope.issue.content!),
    createdBy: scope.userId,
  })
  await opsDb.updateNewsletterIssue(scope.issue.id, { pendingActionId: action.id })
  const approved = await opsDb.approvePendingAction(action.id, scope.orgId, scope.userId)
  if (!approved) throw new Error('The newsletter approval changed; refresh and try again')
  try {
    await executeAction(approved)
    await opsDb.markActionExecuted(approved.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Newsletter delivery failed'
    await opsDb.markActionFailed(approved.id, message)
    throw error
  }
}

export async function approveAndSendWeeklyNewsletter(
  issueId: string,
  content: OpsNewsletterContent,
  expectedRevision: number
): Promise<{ success: true }> {
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled (OPS_ENABLED=false).')
  const scope = await saveNewsletterContent({ issueId, content, expectedRevision })
  await executeReviewedNewsletter(scope)
  revalidatePath('/ops')
  revalidatePath('/ops/newsletters')
  return { success: true }
}

export async function retryWeeklyNewsletter(issueId: string): Promise<{ success: true }> {
  if (!opsEnabled()) throw new Error('Petrios Ops is disabled (OPS_ENABLED=false).')
  const scope = await requireNewsletterIssue(issueId)
  if (!scope.issue.content || !['failed', 'approved'].includes(scope.issue.status)) {
    throw new Error('Only an unfinished reviewed newsletter can be retried')
  }
  await executeReviewedNewsletter(scope)
  revalidatePath('/ops')
  revalidatePath('/ops/newsletters')
  return { success: true }
}
