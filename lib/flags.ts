/**
 * Feature flags.
 *
 * INDIVIDUAL_SIGNUP_ENABLED — solo-educator self-service. When false (the
 * enterprise demo posture) the product is "air-tight" enterprise-only:
 *   • the landing page hides the individual door
 *   • /login/individual redirects to the organisation sign-in
 *   • LoginCard drops its "teach on your own" cross-links
 *   • the dashboard no longer auto-provisions a personal workspace for an
 *     org-less user — passwordless login accepts any email, so this is the
 *     gate that stops an uninvited user from getting a working account. They
 *     hit the "Join a Department" wall instead.
 *
 * Flip to true to re-enable individual onboarding.
 */
export const INDIVIDUAL_SIGNUP_ENABLED = false
