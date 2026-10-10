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
import {
  generateDepartmentNewsletter,
  loadNewsletterWeekSessions,
} from '@/lib/ops/newsletter-job'
import {
  buildNewsletterHtml,
  newsletterIssueControls,
  newsletterPreviewText,
  NewsletterUserError,
  newsletterWindowFromWeekStart,
  normalizeNewsletterEdit,
  type NewsletterIssueControls,
} from '@/lib/ops/newsletter'
import { DbConflictError } from '@/lib/db/errors'
import { formatDayKeyLong } from '@/lib/ops/format'
import * as opsDb from '@/lib/db/ops'
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

export type NewsletterWorkspaceIssue = OpsNewsletterIssue & { controls: NewsletterIssueControls }

export interface NewsletterWorkspace {
  departments: { id: string; name: string; memberCount: number }[]
  issues: NewsletterWorkspaceIssue[]
}

export async function getNewsletterWorkspace(): Promise<NewsletterWorkspace> {
  const { userId, orgId } = await requireOpsManager()
  const departments = await newsletterDepartments(userId, orgId)
  const [issues, memberCounts] = await Promise.all([
    opsDb.listNewsletterIssues(orgId, departments.map((department) => department.id)),
    Promise.all(departments.map((department) => departmentsDb.countDepartmentMembers(department.id))),
  ])
  // Only an apparently untouched issue needs the ledger lock check: any SENT
  // or SENDING row (a cut-off run) keeps it locked although sent_count is 0.
  const locks = await Promise.all(issues.map((issue) =>
    ['draft', 'failed'].includes(issue.status) && issue.sent_count === 0
      ? opsDb.newsletterDeliveryLocked(issue.id)
      : Promise.resolve(issue.sent_count > 0)
  ))
  const now = new Date()
  return {
    departments: departments.map((department, index) => ({
      id: department.id,
      name: department.name,
      memberCount: memberCounts[index],
    })),
    issues: issues.map((issue, index) => ({
      ...issue,
      controls: newsletterIssueControls(issue, locks[index], now),
    })),
  }
}

function newsletterSummaryPoints(content: OpsNewsletterContent) {
  return content.sessions.map((session) => ({
    title: session.title,
    detail: session.overview,
  }))
}

/**
 * Newsletter action result. Expected outcomes (stale tab, empty week, partial
 * delivery, ...) are returned, not thrown: Next masks thrown Server Action
 * messages in production (spec 07). Unexpected errors still throw.
 */
export type NewsletterActionResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string; revision?: number }

function newsletterFailure(error: unknown, extra: { revision?: number } = {}): {
  ok: false
  message: string
  revision?: number
} {
  if (error instanceof NewsletterUserError) return { ok: false, message: error.message, ...extra }
  throw error
}

function requireOpsEnabled(): void {
  if (!opsEnabled()) throw new NewsletterUserError('Petrios Ops is disabled (OPS_ENABLED=false).')
}

function regenerateRefusal(issue: OpsNewsletterIssue, locked: boolean): string | null {
  const controls = newsletterIssueControls(issue, locked, new Date())
  if (controls.regenerable) return null
  if (issue.status === 'sent' || issue.sent_count > 0 || locked) {
    return 'This department newsletter has already been emailed to some or all members, so it cannot be regenerated'
  }
  return 'This newsletter is being delivered; wait for it to finish, then retry any unfinished delivery'
}

export async function generateWeeklyNewsletter(
  departmentId: string,
  weekStartKey: string
): Promise<NewsletterActionResult<{ issueId: string }>> {
  try {
    const { userId, orgId } = await requireOpsManager()
    requireOpsEnabled()
    await requireDepartmentModerator(departmentId)
    const department = await departmentsDb.findDepartment(departmentId, orgId)
    if (!department) throw new Error('Department not found')
    const window = newsletterWindowFromWeekStart(weekStartKey)
    const existing = await opsDb.findNewsletterIssue(orgId, departmentId, window.weekStartKey)
    if (existing) {
      const refusal = regenerateRefusal(existing, await opsDb.newsletterDeliveryLocked(existing.id))
      if (refusal) throw new NewsletterUserError(refusal)
    }

    const run = await startRun('ops_newsletter', 'manual', orgId)
    try {
      const sessions = await loadNewsletterWeekSessions({ orgId, departmentId, window })
      const generated = await generateDepartmentNewsletter({
        departmentName: department.name,
        sessions,
        run,
      })
      const organizationName = (await organizationsDb.findOrganizationName(orgId)) ?? 'Petrios'
      const weekLabel = `Week commencing ${formatDayKeyLong(window.weekStartKey)}`
      const html = buildNewsletterHtml({
        organizationName,
        departmentName: department.name,
        weekLabel,
        content: generated.content,
      })
      const draft = {
        orgId,
        departmentId,
        generatedBy: userId,
        subject: generated.content.subject,
        html,
        summaryPoints: newsletterSummaryPoints(generated.content),
        content: generated.content,
        sourceSessionIds: sessions.map((session) => session.id),
        sourceDocuments: generated.sourceDocuments,
      }
      let issue: OpsNewsletterIssue | null
      if (existing) {
        // Revision strictly increases and is compare-and-set on the revision
        // read above, so a tab holding an older revision cannot overwrite it.
        issue = await opsDb.replaceNewsletterDraft({
          ...draft,
          id: existing.id,
          expectedRevision: existing.content_revision,
        })
        if (!issue) {
          throw new NewsletterUserError('The newsletter changed while it was being generated; refresh and try again')
        }
        await opsDb.deleteUnsentNewsletterDeliveries(existing.id)
      } else {
        try {
          issue = await opsDb.insertNewsletterIssue({ ...draft, weekStart: window.weekStartKey })
        } catch (error) {
          if (error instanceof DbConflictError) {
            throw new NewsletterUserError('Another moderator generated this week at the same time; refresh to review their draft')
          }
          throw error
        }
      }

      await run.finish('succeeded', `Drafted ${department.name} newsletter from ${sessions.length} session(s) and ${generated.sourceDocuments.length} document(s)`)
      revalidatePath('/ops/newsletters')
      return { ok: true, issueId: issue.id }
    } catch (err) {
      await run.finish('failed', err instanceof Error ? err.message : 'newsletter generation failed')
      throw err
    }
  } catch (error) {
    return newsletterFailure(error)
  }
}

async function requireNewsletterIssue(issueId: string) {
  const { userId, orgId } = await requireOpsManager()
  const issue = await opsDb.findNewsletterIssueById(issueId)
  if (!issue || issue.org_id !== orgId || !issue.department_id) throw new NewsletterUserError('Newsletter not found')
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
  requireOpsEnabled()
  const scope = await requireNewsletterIssue(input.issueId)
  const snapshot = scope.issue.content
  if (!snapshot) throw new NewsletterUserError('This legacy newsletter cannot be edited')
  if (scope.issue.sent_count > 0 || await opsDb.newsletterDeliveryLocked(scope.issue.id)) {
    throw new NewsletterUserError('A newsletter that has been emailed to any member can no longer be edited')
  }
  const content = normalizeNewsletterEdit({ ...scope.issue, content: snapshot }, input.content)
  const organizationName = (await organizationsDb.findOrganizationName(scope.orgId)) ?? 'Petrios'
  const weekLabel = `Week commencing ${formatDayKeyLong(scope.issue.week_start)}`
  const issue = await opsDb.saveNewsletterDraft({
    id: scope.issue.id,
    orgId: scope.orgId,
    departmentId: scope.issue.department_id!,
    subject: content.subject,
    html: buildNewsletterHtml({
      organizationName,
      departmentName: scope.department.name,
      weekLabel,
      content,
    }),
    summaryPoints: newsletterSummaryPoints(content),
    content,
    expectedRevision: input.expectedRevision,
  })
  if (!issue) throw new NewsletterUserError('The newsletter changed; refresh before saving again')
  await opsDb.deleteUnsentNewsletterDeliveries(scope.issue.id)
  return { ...scope, issue }
}

export async function saveWeeklyNewsletter(
  issueId: string,
  content: OpsNewsletterContent,
  expectedRevision: number
): Promise<NewsletterActionResult<{ revision: number }>> {
  try {
    const { issue } = await saveNewsletterContent({ issueId, content, expectedRevision })
    revalidatePath('/ops/newsletters')
    return { ok: true, revision: issue.content_revision }
  } catch (error) {
    return newsletterFailure(error)
  }
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
  // The executor links the issue to this action inside its start CAS; a
  // separate write here would refresh `updated_at` and defeat the lease.
  const approved = await opsDb.approvePendingAction(action.id, scope.orgId, scope.userId)
  if (!approved) throw new NewsletterUserError('The newsletter approval changed; refresh and try again')
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
): Promise<NewsletterActionResult<{ revision: number }>> {
  let savedRevision: number | undefined
  try {
    requireOpsEnabled()
    const scope = await saveNewsletterContent({ issueId, content, expectedRevision })
    savedRevision = scope.issue.content_revision
    await executeReviewedNewsletter(scope)
    return { ok: true, revision: savedRevision }
  } catch (error) {
    // Report the saved revision even when delivery failed, so the editor
    // does not keep a revision the server has already moved past.
    return newsletterFailure(error, savedRevision === undefined ? {} : { revision: savedRevision })
  } finally {
    revalidatePath('/ops')
    revalidatePath('/ops/newsletters')
  }
}

export async function retryWeeklyNewsletter(issueId: string): Promise<NewsletterActionResult> {
  try {
    requireOpsEnabled()
    const scope = await requireNewsletterIssue(issueId)
    const locked = scope.issue.sent_count > 0 || await opsDb.newsletterDeliveryLocked(scope.issue.id)
    const controls = newsletterIssueControls(scope.issue, locked, new Date())
    if (controls.inProgress) {
      throw new NewsletterUserError('This newsletter is still being delivered; wait a few minutes before retrying')
    }
    if (!controls.canRetry) {
      throw new NewsletterUserError('Only an unfinished reviewed newsletter can be retried')
    }
    await executeReviewedNewsletter(scope)
    return { ok: true }
  } catch (error) {
    return newsletterFailure(error)
  } finally {
    revalidatePath('/ops')
    revalidatePath('/ops/newsletters')
  }
}
