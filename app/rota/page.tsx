import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentOrgId, getCurrentUserId } from '@/lib/auth'
import * as departmentsDb from '@/lib/db/departments'
import * as rotaDb from '@/lib/db/rota'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getRotaAvailability, isRotaModerator } from '@/lib/rota/access'
import { isRotaKillSwitchOn } from '@/lib/rota/config'

export const dynamic = 'force-dynamic'

/**
 * Rota hub (spec/14): the enrolled departments whose rota the caller may
 * upload (department moderators, org admins, and holders of the rota
 * uploader grant). 404 whenever rota availability is off or not set up.
 */
export default async function RotaHubPage() {
  if (!isRotaKillSwitchOn()) notFound()
  const userId = await getCurrentUserId()
  if (!userId) redirect('/login')
  const orgId = await getCurrentOrgId()
  if (!orgId) notFound()

  const availability = await getRotaAvailability(orgId)
  if (!availability.available) notFound()

  let departments: { id: string; name: string }[] = []
  try {
    const [all, enrolledIds, uploaderIds] = await Promise.all([
      departmentsDb.listDepartmentsByOrg(orgId),
      rotaDb.listRotaDepartmentIds(orgId),
      rotaDb.listUploaderDepartmentIds(orgId, userId),
    ])
    const enrolled = new Set(enrolledIds)
    const uploader = new Set(uploaderIds)
    const candidates = all.filter((d) => enrolled.has(d.id))
    const allowed = await Promise.all(
      candidates.map(async (d) => uploader.has(d.id) || (await isRotaModerator(d.id)))
    )
    departments = candidates
      .filter((_, index) => allowed[index])
      .map((d) => ({ id: d.id, name: d.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    if (error instanceof rotaDb.RotaNotInstalledError) notFound()
    throw error
  }

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="mb-2 font-mono text-2xl font-bold sm:text-3xl">Rota upload</h1>
        <p className="mb-6 font-mono text-sm text-gray-600">
          Upload a department&apos;s rota export. The file is read in your browser and never leaves it.
        </p>
        {departments.length === 0 ? (
          <Card>
            <p className="font-mono text-sm text-gray-600">
              You cannot upload a rota for any department. Ask an organisation admin for the rota uploader role.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {departments.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/departments/${d.id}/rota`}
                  className="block border border-black bg-white px-4 py-3 font-mono text-sm hover:bg-gray-50"
                >
                  {d.name} →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
