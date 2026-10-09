import { LoginCard } from '@/components/LoginCard'
import { safeNextPath } from '@/lib/safe-next-path'

// Neutral sign-in — the middleware fallback for unauthenticated users. Offers
// both the individual and organisation doors without persona-specific copy.
export default async function LoginPage(props: {
  searchParams: Promise<{ next?: string; mode?: string }>
}) {
  const { next, mode } = await props.searchParams
  return <LoginCard variant="neutral" initialPassword={mode === 'password'} nextPath={safeNextPath(next)} />
}
