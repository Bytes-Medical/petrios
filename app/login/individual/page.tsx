import { redirect } from 'next/navigation'
import { LoginCard } from '@/components/LoginCard'
import { INDIVIDUAL_SIGNUP_ENABLED } from '@/lib/flags'

// Individual educators: sign in and we auto-provision a personal workspace.
// Disabled in enterprise-only mode — bounce to the organisation sign-in.
export default function IndividualLoginPage() {
  if (!INDIVIDUAL_SIGNUP_ENABLED) {
    redirect('/login/organisation')
  }
  return <LoginCard variant="individual" />
}
