'use server'

import { requireAuth, requireOrg } from '@/lib/auth'
import * as traineeDb from '@/lib/db/trainee-dashboard'

export async function getMyDepartmentSessions() {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  return traineeDb.listSessionsForUserDepartments(userId, orgId)
}

export async function getMyFeedbackHistory() {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  return traineeDb.listFeedbackByUser(userId, orgId)
}

export async function getMyAttendanceSummary() {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  return traineeDb.getAttendanceSummaryForUser(userId, orgId)
}
