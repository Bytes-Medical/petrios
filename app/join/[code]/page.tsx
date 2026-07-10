import Link from 'next/link'
import { Card } from '@/components/Card'
import { JoinDepartmentInviteForm } from '@/components/JoinDepartmentInviteForm'
import { getJoinInviteLandingData } from '@/app/actions/member-onboarding'

export const dynamic = 'force-dynamic'

export default async function JoinDepartmentPage(
  props: {
    params: Promise<{ code: string }>
  }
) {
  const params = await props.params;
  const invite = await getJoinInviteLandingData(params.code)

  if (!invite) {
    return (
      <div className="min-h-screen px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <Card>
            <h1 className="font-mono text-2xl font-bold">Invite Not Found</h1>
            <p className="mt-3 font-mono text-sm text-gray-600">
              This department invite link is invalid or has been rotated.
            </p>
            <Link href="/login" className="mt-4 inline-block font-mono text-sm underline">
              Go to Trainee Sign-In →
            </Link>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <h1 className="font-mono text-3xl font-bold sm:text-4xl">Department Invite</h1>
          <p className="mt-3 font-mono text-sm text-gray-600">
            Complete your details to join this organization and department.
          </p>
        </div>

        <JoinDepartmentInviteForm
          inviteCode={invite.inviteCode}
          organizationName={invite.organizationName}
          departmentName={invite.departmentName}
          isSignedIn={invite.isSignedIn}
          initialEmail={invite.initialEmail}
          initialFirstName={invite.initialFirstName}
          initialLastName={invite.initialLastName}
        />
      </div>
    </div>
  )
}
