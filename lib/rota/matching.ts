import type { RotaBatchPerson } from './types'

/**
 * Server-side identity resolution for one validated batch (spec/14, O1).
 * Pure: the caller supplies the HMAC function, the org's links for the
 * batch's keys, and the department's CURRENT trainees.
 *
 * Order per person:
 *   1. a moderator-confirmed `link.user_id` (moderators only; must be a
 *      current trainee). Names never reach the server: a name confirmation
 *      arrives as a bare link (D3).
 *   2. STAFF_ID link → 3. EMAIL link → 4. exact profile email.
 * Every resolved user must be a current trainee of the department.
 *
 * Conflicts:
 *   - keys of one row resolve to different users → row unmatched, conflict;
 *   - the same user resolved from several rows → all of them unmatched, each
 *     a conflict.
 * newLinks: only for accepted moderator links: STAFF_ID when the row has a
 * staff key, else EMAIL when it has an email, else none. The link origin is
 * decided HERE, never taken from the browser: EMAIL_MATCH only when the row's
 * email is exactly the confirmed trainee's profile email, otherwise MODERATOR.
 */

export type RotaKeyType = 'STAFF_ID' | 'EMAIL'

export interface ResolveRotaPeopleInput {
  people: RotaBatchPerson[]
  hmacOf: (keyType: RotaKeyType, normalised: string) => string
  links: { keyType: RotaKeyType; keyHmac: string; userId: string }[]
  trainees: { userId: string; email: string }[]
  callerRole: 'MODERATOR' | 'UPLOADER'
}

export interface ResolveRotaPeopleResult {
  matched: { ref: string; userId: string; days: string }[]
  unmatched: number
  conflicts: number
  newLinks: { keyType: RotaKeyType; keyHmac: string; userId: string; origin: 'MODERATOR' | 'EMAIL_MATCH' }[]
  /** How each matched row resolved (for the moderator preview). */
  via: Map<string, 'LINK' | 'EMAIL'>
}

export function resolveRotaPeople(input: ResolveRotaPeopleInput): ResolveRotaPeopleResult {
  const traineeIds = new Set(input.trainees.map((t) => t.userId))
  const byEmail = new Map<string, string>()
  for (const trainee of input.trainees) {
    const email = trainee.email.trim().toLowerCase()
    if (!email) continue
    // Two trainees sharing an address are ambiguous: match neither.
    byEmail.set(email, byEmail.has(email) && byEmail.get(email) !== trainee.userId ? '' : trainee.userId)
  }
  const linkMap = new Map<string, string>()
  for (const link of input.links) linkMap.set(`${link.keyType}|${link.keyHmac}`, link.userId)

  type Candidate = {
    ref: string
    days: string
    userId: string
    via: 'LINK' | 'EMAIL'
    newLink: ResolveRotaPeopleResult['newLinks'][number] | null
  }
  const candidates: Candidate[] = []
  let conflicts = 0

  for (const person of input.people) {
    const staffHmac = person.staff_key ? input.hmacOf('STAFF_ID', person.staff_key) : null
    const emailHmac = person.email ? input.hmacOf('EMAIL', person.email) : null

    if (person.link && input.callerRole === 'MODERATOR') {
      const userId = person.link.user_id
      if (!traineeIds.has(userId)) continue
      let newLink: Candidate['newLink'] = null
      const keyType: RotaKeyType | null = staffHmac ? 'STAFF_ID' : emailHmac ? 'EMAIL' : null
      const keyHmac = staffHmac ?? emailHmac
      if (keyType && keyHmac && linkMap.get(`${keyType}|${keyHmac}`) !== userId) {
        const origin = person.email && byEmail.get(person.email) === userId ? 'EMAIL_MATCH' : 'MODERATOR'
        newLink = { keyType, keyHmac, userId, origin }
      }
      candidates.push({ ref: person.ref, days: person.days, userId, via: 'LINK', newLink })
      continue
    }

    const resolved: { userId: string; via: 'LINK' | 'EMAIL' }[] = []
    const staffUser = staffHmac ? linkMap.get(`STAFF_ID|${staffHmac}`) : undefined
    if (staffUser && traineeIds.has(staffUser)) resolved.push({ userId: staffUser, via: 'LINK' })
    const emailLinkUser = emailHmac ? linkMap.get(`EMAIL|${emailHmac}`) : undefined
    if (emailLinkUser && traineeIds.has(emailLinkUser)) resolved.push({ userId: emailLinkUser, via: 'LINK' })
    const profileUser = person.email ? byEmail.get(person.email) : undefined
    if (profileUser) resolved.push({ userId: profileUser, via: 'EMAIL' })

    if (resolved.length === 0) continue
    if (new Set(resolved.map((r) => r.userId)).size > 1) {
      conflicts++
      continue
    }
    candidates.push({ ref: person.ref, days: person.days, userId: resolved[0].userId, via: resolved[0].via, newLink: null })
  }

  const perUser = new Map<string, number>()
  for (const c of candidates) perUser.set(c.userId, (perUser.get(c.userId) ?? 0) + 1)

  const matched: ResolveRotaPeopleResult['matched'] = []
  const newLinks: ResolveRotaPeopleResult['newLinks'] = []
  const via = new Map<string, 'LINK' | 'EMAIL'>()
  for (const c of candidates) {
    if ((perUser.get(c.userId) ?? 0) > 1) {
      conflicts++
      continue
    }
    matched.push({ ref: c.ref, userId: c.userId, days: c.days })
    via.set(c.ref, c.via)
    if (c.newLink) newLinks.push(c.newLink)
  }

  return { matched, unmatched: input.people.length - matched.length, conflicts, newLinks, via }
}
