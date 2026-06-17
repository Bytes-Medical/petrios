import { LoginCard } from '@/components/LoginCard'

// Neutral sign-in — the middleware fallback for unauthenticated users. Offers
// both the individual and organisation doors without persona-specific copy.
export default function LoginPage() {
  return <LoginCard variant="neutral" />
}
