import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUserId } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { RotaUploadLazy } from '@/components/rota/RotaUploadLazy'
import { RotaLinkedStaffPanel } from '@/components/rota/RotaLinkedStaffPanel'
import { RotaManualLinkForm } from '@/components/rota/RotaManualLinkForm'
import { getRotaUploadContext } from '@/app/actions/rota-upload'
import { listRotaLinkedStaff } from '@/app/actions/rota-identity'
import * as departmentsDb from '@/lib/db/departments'
import { appTimeZone } from '@/lib/datetime'
import { RotaAccessError, requireRotaUploaderOrModerator } from '@/lib/rota/access'
import { isRotaKillSwitchOn } from '@/lib/rota/config'

export const dynamic = 'force-dynamic'

/**
 * Department rota page (spec/14): the upload wizard for rota moderators and
 * rota uploaders, plus "Linked staff" (review, link by staff number, revoke)
 * for moderators. 404 unless the kill
 * switch is on, rota is enabled for the org, the department is enrolled and
 * the caller may upload.
 */
export default async function DepartmentRotaPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  if (!isRotaKillSwitchOn()) notFound()
  if (!(await getCurrentUserId())) redirect('/login')

  let role: 'MODERATOR' | 'UPLOADER'
  let orgId: string
  try {
    ;({ role, orgId } = await requireRotaUploaderOrModerator(id))
  } catch (error) {
    if (error instanceof RotaAccessError) notFound()
    throw error
  }

  const [context, linked, department] = await Promise.all([
    getRotaUploadContext(id),
    role === 'MODERATOR' ? listRotaLinkedStaff(id) : Promise.resolve(null),
    departmentsDb.findDepartment(id, orgId).catch(() => null),
  ])
  if (!context.ok) notFound()
  const timeZone = appTimeZone()

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="mb-2 font-mono text-2xl font-bold sm:text-3xl">{department?.name ?? 'Department'}: rota</h1>
            <p className="font-mono text-sm text-gray-600">
              Last as-worked upload: {context.data.latest.worked ?? 'none'} · Last planned upload:{' '}
              {context.data.latest.planned ?? 'none'}
            </p>
          </div>
          <Link
            href="/rota"
            className="border border-black bg-white px-4 py-3 text-center font-mono text-sm text-black hover:bg-gray-50"
          >
            All rota uploads
          </Link>
        </div>

        <Card className="mb-8">
          <h2 className="mb-4 font-mono text-xl font-bold">Upload the rota</h2>
          <RotaUploadLazy departmentId={id} context={context.data} />
        </Card>

        {role === 'MODERATOR' ? (
          <Card>
            <h2 className="mb-2 font-mono text-xl font-bold">Linked staff</h2>
            <p className="mb-4 font-mono text-xs text-gray-600">
              Current trainees whose rota rows you have confirmed. Petrios keeps a keyed hash, never the staff number
              or email itself.
            </p>
            {linked && linked.ok ? (
              <RotaLinkedStaffPanel departmentId={id} rows={linked.data} timeZone={timeZone} />
            ) : (
              <p className="font-mono text-sm text-gray-600">{linked && !linked.ok ? linked.message : null}</p>
            )}
            {context.data.roster ? (
              <div className="mt-6 border-t border-black pt-6">
                <RotaManualLinkForm
                  departmentId={id}
                  roster={context.data.roster.map((t) => ({ userId: t.userId, displayName: t.displayName }))}
                />
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  )
}
