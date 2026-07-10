'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOrg, requireDepartmentModerator } from '@/lib/auth'
import { getAppUrl } from '@/lib/app-url'
import { getEmailClient, getFromAddress } from '@/lib/email'
import {
  buildSlotClaimedEmailHtml,
  buildSlotOfferExternalEmailHtml,
  buildSlotOfferMemberEmailHtml,
  type SlotOfferEmailSlot,
} from '@/lib/email-templates'
import {
  buildSlotDrafts,
  dedupeSlotRecipients,
  describeSlot,
  generateClaimCode,
  slotDisplayStatus,
} from '@/lib/slot-schedule'
import { generateCode } from '@/lib/codes'
import { contactDisplayName, profileDisplayName } from '@/lib/contacts'
import { notifyUser } from '@/lib/notify'
import { emitWebhook } from '@/lib/webhooks'
import {
  LOCATION_TYPE_LABELS,
  type LocationType,
  type SlotDisplayStatus,
  type TeachingSlot,
} from '@/lib/types'
import * as slotsDb from '@/lib/db/teaching-slots'
import * as contactsDb from '@/lib/db/external-contacts'
import * as departmentsDb from '@/lib/db/departments'
import * as onboardingDb from '@/lib/db/onboarding'
import * as notificationsDb from '@/lib/db/notifications'
import * as attendanceDb from '@/lib/db/attendance'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'
import { DbNotFoundError } from '@/lib/db'

const PLACEHOLDER_TITLE = 'Teaching session — topic TBC'

// -----------------------------------------------------------------------------
// Moderator: create / list / close / publish
// -----------------------------------------------------------------------------

export async function createTeachingSlots(
  departmentId: string,
  input: {
    dayKeys: string[]
    time: string
    durationMins: number
    locationType: LocationType
  }
) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  await requireDepartmentModerator(departmentId)

  const drafts = buildSlotDrafts(input.dayKeys, input.time, input.durationMins)

  const slots = await slotsDb.insertSlots({
    orgId,
    departmentId,
    createdBy: userId,
    locationType: input.locationType,
    slots: drafts,
  })

  revalidatePath(`/departments/${departmentId}/schedule`)
  revalidatePath('/dashboard')
  return { created: slots.length }
}

export interface DepartmentSlotView extends TeachingSlot {
  display_status: SlotDisplayStatus
}

export async function getDepartmentSlots(
  departmentId: string
): Promise<DepartmentSlotView[]> {
  const orgId = await requireOrg()
  await requireDepartmentModerator(departmentId)

  const slots = await slotsDb.listSlotsForDepartment(orgId, departmentId)

  return slots.map((slot) => ({ ...slot, display_status: slotDisplayStatus(slot) }))
}

export async function closeTeachingSlot(slotId: string) {
  const orgId = await requireOrg()
  const slot = await slotsDb.findSlot(slotId, orgId)
  if (!slot) throw new DbNotFoundError('Slot not found')
  await requireDepartmentModerator(slot.department_id)

  const closed = await slotsDb.closeSlot({ orgId, slotId })
  if (!closed) {
    throw new Error('Only open slots can be closed')
  }

  revalidatePath(`/departments/${slot.department_id}/schedule`)
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteTeachingSlot(slotId: string) {
  const orgId = await requireOrg()
  const slot = await slotsDb.findSlot(slotId, orgId)
  if (!slot) throw new DbNotFoundError('Slot not found')
  await requireDepartmentModerator(slot.department_id)

  if (slot.status === 'CLAIMED') {
    throw new Error('Claimed slots cannot be deleted — manage the session instead')
  }

  await slotsDb.deleteOpenSlot({ orgId, slotId })
  revalidatePath(`/departments/${slot.department_id}/schedule`)
  revalidatePath('/dashboard')
  return { success: true }
}

function slotToOfferEmailRow(slot: TeachingSlot): SlotOfferEmailSlot {
  return {
    ...describeSlot(slot),
    locationLabel: LOCATION_TYPE_LABELS[slot.location_type] ?? slot.location_type,
  }
}

export async function publishSlots(
  departmentId: string,
  input: {
    slotIds: string[]
    groupIds: string[]
    allDepartmentMembers: boolean
    allOrgMembers: boolean
  }
) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  await requireDepartmentModerator(departmentId)

  if (input.slotIds.length === 0) {
    throw new Error('Select at least one slot to publish')
  }
  if (!input.groupIds.length && !input.allDepartmentMembers && !input.allOrgMembers) {
    throw new Error('Pick at least one audience')
  }

  // Validate the slots are this department's open, future slots.
  const departmentSlots = await slotsDb.listSlotsForDepartment(orgId, departmentId)
  const now = Date.now()
  const publishable = departmentSlots.filter(
    (slot) =>
      input.slotIds.includes(slot.id) &&
      slot.status === 'OPEN' &&
      new Date(slot.date_start).getTime() > now
  )
  if (publishable.length === 0) {
    throw new Error('None of the selected slots are open and in the future')
  }

  // Resolve audiences.
  const memberIds = new Set<string>()
  if (input.allDepartmentMembers) {
    for (const id of await departmentsDb.listDepartmentMemberUserIds(departmentId)) {
      memberIds.add(id)
    }
  }
  if (input.allOrgMembers) {
    for (const row of await onboardingDb.listOrganizationMembers(orgId)) {
      memberIds.add(row.user_id)
    }
  }
  // The publisher shouldn't be invited to claim their own slots.
  memberIds.delete(userId)

  const [memberProfiles, groupContacts] = await Promise.all([
    onboardingDb.listProfilesForUsers(Array.from(memberIds)),
    contactsDb.listContactsInGroups(orgId, input.groupIds),
  ])

  const deduped = dedupeSlotRecipients(
    memberProfiles
      .filter((p) => p.email)
      .map((p) => ({ userId: p.user_id, email: p.email as string })),
    groupContacts.map((c) => ({ contactId: c.id, email: c.email }))
  )

  if (deduped.members.length === 0 && deduped.contacts.length === 0) {
    throw new Error('The selected audience has no recipients')
  }

  const contactCodes = new Map(
    deduped.contacts.map((c) => [c.contactId, generateClaimCode()])
  )

  const { publicationId } = await slotsDb.insertPublication({
    orgId,
    departmentId,
    createdBy: userId,
    audience: {
      groupIds: input.groupIds,
      allDepartmentMembers: input.allDepartmentMembers,
      allOrgMembers: input.allOrgMembers,
    },
    slotIds: publishable.map((s) => s.id),
    recipients: [
      ...deduped.members.map((m) => ({ userId: m.userId, email: m.email })),
      ...deduped.contacts.map((c) => ({
        contactId: c.contactId,
        email: c.email,
        claimCode: contactCodes.get(c.contactId),
      })),
    ],
  })

  const links = await slotsDb.listClaimLinksForPublication(publicationId)
  const departmentName =
    (await teacherInvitationsDb.findDepartmentName(departmentId)) || 'Your department'
  const offerRows = publishable.map(slotToOfferEmailRow)
  const appUrl = getAppUrl()
  const mailer = getEmailClient()
  const fromAddress = getFromAddress()

  // Loop-invariant: every registered member gets the identical email body.
  const memberHtml = buildSlotOfferMemberEmailHtml({
    departmentName,
    slots: offerRows,
    dashboardUrl: `${appUrl}/dashboard?tab=teaching`,
  })

  let emailed = 0
  let failed = 0

  for (const link of links) {
    try {
      const html = link.claim_code
        ? buildSlotOfferExternalEmailHtml({
            departmentName,
            slots: offerRows,
            claimUrl: `${appUrl}/claim/${link.claim_code}`,
          })
        : memberHtml

      const { error } = await mailer.emails.send({
        from: fromAddress,
        to: link.email,
        subject: `Teaching slots available — ${departmentName}`,
        html,
      })
      if (error) throw new Error(error.message)

      await slotsDb.markClaimLinkEmailed(link.id)
      emailed++
    } catch (err) {
      failed++
      console.error(`Failed to email slot offer to ${link.email}:`, err)
    }

    if (link.user_id) {
      try {
        await notificationsDb.insertNotificationAsSystem({
          orgId,
          userId: link.user_id,
          type: 'SLOT_PUBLISHED',
          title: 'New teaching slots available',
          body: `${departmentName} — ${publishable.length} slot${publishable.length === 1 ? '' : 's'} open to claim`,
          link: '/dashboard?tab=teaching',
        })
      } catch (err) {
        console.error('Failed to create slot notification:', err)
      }
    }
  }

  revalidatePath(`/departments/${departmentId}/schedule`)
  return { recipients: links.length, emailed, failed }
}

// -----------------------------------------------------------------------------
// Claiming
// -----------------------------------------------------------------------------

interface ClaimContext {
  slotId: string
  orgId: string
  claimerName: string
  claimedByUserId?: string
  claimedByContactId?: string
  topicSuggestion?: string
  /** Attach path for externals; runs after the session exists. */
  attachExternal?: (sessionId: string) => Promise<void>
}

/** Shared claim orchestration: atomic claim -> session -> attach -> notify. */
async function performClaim(ctx: ClaimContext) {
  const claimed = await slotsDb.claimSlot({
    slotId: ctx.slotId,
    orgId: ctx.orgId,
    claimedByUserId: ctx.claimedByUserId,
    claimedByContactId: ctx.claimedByContactId,
    claimedName: ctx.claimerName,
    topicSuggestion: ctx.topicSuggestion,
  })

  if (!claimed) {
    throw new Error('Sorry — this slot was just claimed by someone else.')
  }

  let sessionId: string
  try {
    const session = await slotsDb.insertClaimedSessionAsSystem({
      orgId: ctx.orgId,
      departmentId: claimed.department_id,
      title: ctx.topicSuggestion?.trim() || PLACEHOLDER_TITLE,
      dateStart: claimed.date_start,
      dateEnd: claimed.date_end,
      locationType: claimed.location_type,
      createdBy: claimed.created_by,
    })
    sessionId = session.id

    if (ctx.claimedByUserId) {
      await slotsDb.insertAcceptedSessionTeacherAsSystem({
        orgId: ctx.orgId,
        sessionId,
        userId: ctx.claimedByUserId,
        invitedBy: claimed.created_by,
      })
      // Teaching a session counts as attending it (same as accepting a
      // teaching assignment). Non-fatal.
      try {
        await attendanceDb.insertAttendanceEvidenceAsSystem({
          orgId: ctx.orgId,
          sessionId,
          departmentId: claimed.department_id,
          userId: ctx.claimedByUserId,
          source: 'TEACHER',
          observedAt: new Date().toISOString(),
          metadata: { assigned_as_teacher: true },
        })
      } catch (err) {
        console.error('Failed to record teacher evidence for claim:', err)
      }
    }

    if (ctx.attachExternal) {
      await ctx.attachExternal(sessionId)
    }

    await slotsDb.linkSlotSession({ slotId: claimed.id, sessionId })

    void emitWebhook(claimed.org_id, 'slot.claimed', {
      slot_id: claimed.id,
      session_id: sessionId,
      department_id: claimed.department_id,
      date_start: claimed.date_start,
    })
  } catch (err) {
    // Compensation: the slot goes back on offer rather than being stuck
    // CLAIMED with no session.
    try {
      await slotsDb.revertClaim(claimed.id)
    } catch (revertErr) {
      console.error('Failed to revert claim after error:', revertErr)
    }
    throw err
  }

  // Notify the slot creator (bell + email). Non-fatal.
  const startDate = new Date(claimed.date_start)
  const slotDateStr = startDate.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const slotTimeStr = startDate.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const departmentName =
    (await teacherInvitationsDb
      .findDepartmentName(claimed.department_id)
      .catch(() => null)) || 'your department'

  await notifyUser({
    orgId: ctx.orgId,
    userId: claimed.created_by,
    notification: {
      type: 'SLOT_CLAIMED',
      title: `${ctx.claimerName} claimed a teaching slot`,
      body: `${slotDateStr}, ${slotTimeStr} — assign the topic when ready`,
      link: `/sessions/${sessionId}/manage`,
    },
    email: {
      subject: `Slot claimed: ${slotDateStr} — ${ctx.claimerName}`,
      html: buildSlotClaimedEmailHtml({
        claimerName: ctx.claimerName,
        departmentName,
        slotDateStr,
        slotTimeStr,
        manageUrl: `${getAppUrl()}/sessions/${sessionId}/manage`,
      }),
    },
  })

  revalidatePath('/dashboard')
  revalidatePath(`/departments/${claimed.department_id}/schedule`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true, sessionId }
}

export async function claimSlotAsMember(slotId: string, topicSuggestion?: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const [slot, invited, profile] = await Promise.all([
    slotsDb.findSlot(slotId, orgId),
    slotsDb.hasClaimLinkForSlot({ slotId, userId }),
    onboardingDb.findProfileByUserId(userId).catch(() => null),
  ])
  if (!slot) throw new DbNotFoundError('Slot not found')
  if (!invited) {
    throw new Error('This slot has not been offered to you')
  }

  return performClaim({
    slotId: slot.id,
    orgId,
    claimerName: profileDisplayName(profile, 'A member'),
    claimedByUserId: userId,
    topicSuggestion,
  })
}

/** PUBLIC action: external contacts claim via their capability code. */
export async function claimSlotByCode(
  code: string,
  slotId: string,
  firstName: string,
  lastName: string,
  topicSuggestion?: string
) {
  const link = await slotsDb.findClaimLinkByCode(code)
  if (!link || !link.contact_id) {
    throw new DbNotFoundError('This claim link is not valid')
  }
  if (!firstName.trim() || !lastName.trim()) {
    throw new Error('Please enter your name')
  }

  const [slot, offered] = await Promise.all([
    slotsDb.findSlot(slotId, link.org_id),
    slotsDb.hasClaimLinkForSlot({
      slotId,
      contactId: link.contact_id,
      publicationId: link.publication_id,
    }),
  ])
  if (!slot) throw new DbNotFoundError('Slot not found')
  if (!offered) {
    throw new Error('This slot is not part of your invitation')
  }

  // Self-reported names are authoritative.
  const contact = await contactsDb.upsertContactByEmail({
    orgId: link.org_id,
    email: link.email,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    overwriteNames: true,
  })

  // Same shape as teacher-invitations' session-scoped RSVP codes.
  const inviteCode = generateCode(8)

  return performClaim({
    slotId: slot.id,
    orgId: link.org_id,
    claimerName: contactDisplayName(contact),
    claimedByContactId: contact.id,
    topicSuggestion,
    attachExternal: async (sessionId) => {
      // ACCEPTED teacher_invitations row so certificates / feedback-release
      // flows treat the external claimer exactly like an RSVP'd teacher.
      await slotsDb.insertAcceptedExternalInvitationAsSystem({
        orgId: link.org_id,
        sessionId,
        email: link.email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        inviteCode,
        sentBy: slot.created_by,
      })
    },
  })
}

// -----------------------------------------------------------------------------
// Reads for calendar + dashboard
// -----------------------------------------------------------------------------

/** Groups + audience counts for the publish dialog (lean: no member lists). */
export async function getPublishAudienceMeta(departmentId: string) {
  const orgId = await requireOrg()
  await requireDepartmentModerator(departmentId)

  const [groups, deptMemberCount, orgMemberCount] = await Promise.all([
    contactsDb.listGroupsWithCounts(orgId),
    departmentsDb.countDepartmentMembers(departmentId),
    onboardingDb.countOrganizationMembers(orgId),
  ])
  return { groups, deptMemberCount, orgMemberCount }
}

export async function getOpenSlotsForCalendar(departmentId?: string) {
  const orgId = await requireOrg()
  return slotsDb.listActiveSlotsForOrg(orgId, departmentId)
}

export interface ClaimableSlotView extends TeachingSlot {
  department_name: string
}

export async function getMyClaimableSlots(): Promise<ClaimableSlotView[]> {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const slots = await slotsDb.listClaimableSlotsForUser(userId, orgId)
  if (slots.length === 0) return []

  const names = await departmentsDb.listDepartmentNames(
    slots.map((slot) => slot.department_id)
  )

  return slots.map((slot) => ({
    ...slot,
    department_name: names.get(slot.department_id) ?? '',
  }))
}
