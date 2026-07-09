import { Card } from '@/components/Card'
import { SlotClaimPanel } from '@/components/SlotClaimPanel'
import * as slotsDb from '@/lib/db/teaching-slots'

export const dynamic = 'force-dynamic'

export default async function ClaimSlotPage({
  params,
}: {
  params: { code: string }
}) {
  const link = await slotsDb.findClaimLinkByCode(params.code)

  if (!link || !link.contact_id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card>
          <h1 className="text-xl font-mono font-bold mb-2">Link Not Found</h1>
          <p className="font-mono text-sm text-gray-600">
            This claim link is invalid or has expired.
          </p>
        </Card>
      </div>
    )
  }

  const openSlots = await slotsDb.listOpenSlotsForPublication(link.publication_id)
  const departmentName = link.department_name ?? 'the department'

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2 break-words">
            Teaching Slots — {departmentName}
          </h1>
          <p className="font-mono text-sm text-gray-600">
            Pick a slot that suits you. Slots are first come, first served —
            once claimed, a slot disappears for everyone else. The organiser
            will confirm the session topic with you afterwards.
          </p>
        </div>

        {openSlots.length === 0 ? (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-2">No Slots Available</h2>
            <p className="font-mono text-sm text-gray-600">
              All offered slots have been claimed or have passed. The organiser
              may publish more availability later.
            </p>
          </Card>
        ) : (
          <Card>
            <SlotClaimPanel
              code={params.code}
              slots={openSlots}
              initialFirstName={link.contact?.first_name ?? ''}
              initialLastName={link.contact?.last_name ?? ''}
            />
          </Card>
        )}
      </div>
    </div>
  )
}
