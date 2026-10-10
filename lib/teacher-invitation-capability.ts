/**
 * Whether an external teacher's invite code may be treated as a capability
 * that unlocks service-role reads (the RSVP page's session details) and a
 * MODERATOR room pass (getExternalTeacherMeetingJoin).
 *
 * Why this is an explicit operator switch: migration 017 created two
 * `teacher_invitations` policies with no role restriction —
 * `Public can read invitation by code` (SELECT USING true) and
 * `Public can respond to invitation` (UPDATE USING true WITH CHECK true). While
 * they are live, anyone holding the public anon key can list every invite code
 * or rewrite any invitation row, so an invite code proves nothing. Every app
 * path already uses the service role, so nothing depends on those policies;
 * migration 062 removes them (spec/13 "External teacher invite codes"; apply
 * and verify it with docs/security/rls-lockdown.md).
 *
 * Only after that migration has been applied (and checked) does the operator set
 * TEACHER_INVITATIONS_RLS_LOCKED=true. Until then (the default) the RSVP page
 * reads the session through RLS only (signed-out visitors see the RSVP form
 * without session details) and external teachers get no embedded room pass;
 * meet.jit.si rooms and Teams links are unaffected.
 */

export const TEACHER_INVITATIONS_RLS_LOCKED_VAR = 'TEACHER_INVITATIONS_RLS_LOCKED'

type Env = Record<string, string | undefined>

/** True only for the exact value "true" (any other value keeps the safe default). */
export function inviteCodeIsTrustedCapability(env: Env = process.env): boolean {
  return env[TEACHER_INVITATIONS_RLS_LOCKED_VAR]?.trim() === 'true'
}

let warned = false

/**
 * inviteCodeIsTrustedCapability, logging ONE operator-facing warning per
 * process the first time an invite code is refused as a capability. The log
 * names the variable and the spec section only.
 */
export function inviteCodeCapabilityOrWarn(env: Env = process.env): boolean {
  const trusted = inviteCodeIsTrustedCapability(env)
  if (!trusted && !warned) {
    warned = true
    console.warn(
      `[petrios-meet] ${TEACHER_INVITATIONS_RLS_LOCKED_VAR} is not "true": external teacher invite codes do not unlock session details or room passes. Apply the teacher_invitations policy fix in spec/13, then set it.`
    )
  }
  return trusted
}

/** Test hook. */
export function resetInviteCodeCapabilityWarningForTests(): void {
  warned = false
}
