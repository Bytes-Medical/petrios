import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentOrgId, getCurrentUser, isOrgAdmin, isOrgManager } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { SettingsSection } from '@/components/SettingsSection'
import { CertificateSettingsPanel } from '@/components/CertificateSettingsPanel'
import { DepartmentNamePanel } from '@/components/DepartmentNamePanel'
import { FeedbackTemplatePanel } from '@/components/FeedbackTemplatePanel'
import { DepartmentInviteLinksPanel } from '@/components/DepartmentInviteLinksPanel'
import { OrgMembersPanel } from '@/components/OrgMembersPanel'
import {
  getDepartmentCertificateSettings,
  getDepartmentsForOrg,
  getMyModeratedDepartments,
  getDepartmentMembersWithProfiles,
} from '@/app/actions/departments'
import type { DepartmentMemberWithProfile } from '@/app/actions/departments'
import {
  getManagedDepartmentInviteLinks,
  getOrgMembersForManagement,
} from '@/app/actions/member-onboarding'
import { DepartmentMembersPanel } from '@/components/DepartmentMembersPanel'
import { AddressBookPanel } from '@/components/AddressBookPanel'
import { ContactGroupsPanel } from '@/components/ContactGroupsPanel'
import { ApiTokensPanel } from '@/components/ApiTokensPanel'
import { WebhooksPanel } from '@/components/WebhooksPanel'
import { listOrgApiTokens, listWebhooks, type SafeApiToken, type WebhookView } from '@/app/actions/api-platform'
import type { WebhookDelivery } from '@/lib/db/api-platform'
import { getRotaAdminState } from '@/app/actions/rota-admin'
import { RotaSettingsPanel } from '@/components/rota/RotaSettingsPanel'
import { RotaUploadersPanel } from '@/components/rota/RotaUploadersPanel'
import { isRotaKillSwitchOn } from '@/lib/rota/config'
import { appTimeZone } from '@/lib/datetime'
import type { RotaAdminState, RotaResult } from '@/lib/rota/types'
import { getAddressBook } from '@/app/actions/contacts'
import type {
  ContactGroupWithCount,
  ExternalContact,
  ManagedDepartmentInviteLink,
  ManagedOrgMember,
} from '@/lib/types'

export default async function SettingsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  let editableDepartments: { id: string; name: string }[] = []
  let orgManager = false
  let inviteLinks: ManagedDepartmentInviteLink[] = []
  let orgMembers: ManagedOrgMember[] = []
  let addressBook: {
    contacts: ExternalContact[]
    groups: ContactGroupWithCount[]
    groupsByContact: Record<string, string[]>
  } = { contacts: [], groups: [], groupsByContact: {} }
  let apiTokens: SafeApiToken[] = []
  let webhookData: { endpoints: WebhookView[]; deliveries: WebhookDelivery[] } = {
    endpoints: [],
    deliveries: [],
  }
  let orgAdminAccess = false
  // Rota availability (spec/14): org admins only. Full controls while the
  // ROTA_INTEGRATION_ENABLED kill switch is on; with it off, a cleanup-only
  // section (disable, remove departments/uploaders) appears only when this
  // organisation still holds rota data.
  let rotaAdmin: RotaResult<RotaAdminState> | null = null

  if (orgId) {
    const [orgAdmin, canManageOrgAccess, orgDepartments, moderatedDepartments] = await Promise.all([
      isOrgAdmin(orgId),
      isOrgManager(orgId),
      getDepartmentsForOrg(orgId),
      getMyModeratedDepartments(orgId),
    ])

    orgManager = canManageOrgAccess

    editableDepartments = orgAdmin
      ? orgDepartments.map((department) => ({
          id: department.id,
          name: department.name,
        }))
      : moderatedDepartments

    if (orgManager) {
      ;[inviteLinks, orgMembers, addressBook] = await Promise.all([
        getManagedDepartmentInviteLinks(),
        getOrgMembersForManagement(),
        getAddressBook(),
      ])
    }

    // Developer platform surfaces are org-admin only (tokens grant API access
    // to the whole org's data).
    orgAdminAccess = orgAdmin
    if (orgAdmin) {
      ;[apiTokens, webhookData, rotaAdmin] = await Promise.all([
        listOrgApiTokens(),
        listWebhooks(),
        getRotaAdminState(),
      ])
      if (rotaAdmin && !rotaAdmin.ok && !isRotaKillSwitchOn()) rotaAdmin = null
    }
  }

  const departmentSettings = await Promise.all(
    editableDepartments.map(async (department) => {
      const [settings, members] = await Promise.all([
        getDepartmentCertificateSettings(department.id),
        // Org managers see the single Organization Members list instead of
        // a per-department copy, so skip the redundant fetch for them.
        orgManager ? Promise.resolve([]) : getDepartmentMembersWithProfiles(department.id),
      ])
      return { department, settings, members }
    })
  )
  const hasSettingsContent = orgManager || departmentSettings.length > 0

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-mono font-bold">Settings</h1>
            {process.env.SELF_HOSTED_SETUP === 'true' && <Link className="mt-2 inline-block text-sm underline" href="/settings/installation">Installation status</Link>}
            <p className="mt-2 font-mono text-sm text-gray-600">
              Manage department access, invite links, and certificate defaults.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="border border-black bg-white px-4 py-3 text-center font-mono text-sm text-black hover:bg-gray-50"
          >
            Back to Dashboard
          </Link>
        </div>

        {!orgId ? (
          <Card>
            <h2 className="mb-3 text-xl font-mono font-bold">Organization Required</h2>
            <p className="mb-4 font-mono text-sm text-gray-600">
              Join or create an organization before configuring certificate settings.
            </p>
            <Link href="/admin" className="font-mono text-sm underline">
              Go to Admin →
            </Link>
          </Card>
        ) : !hasSettingsContent ? (
          <Card>
            <h2 className="mb-3 text-xl font-mono font-bold">No Editable Settings</h2>
            <p className="font-mono text-sm text-gray-600">
              Settings are available to department moderators and org admins.
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {orgManager ? (
              <div className="space-y-4">
                <SettingsSection
                  title="Department Invite Links"
                  description="Reusable invite links and QR codes; invited users join this organization and department after the email flow."
                  count={inviteLinks.length}
                >
                  <DepartmentInviteLinksPanel links={inviteLinks} />
                </SettingsSection>

                <SettingsSection
                  title="Organization Members"
                  description="Remove trainees or faculty. Protected roles stay managed separately."
                  count={orgMembers.length}
                  scroll
                >
                  <OrgMembersPanel members={orgMembers} />
                </SettingsSection>

                <SettingsSection
                  title="Address Book"
                  description="External contacts captured from invitations and RSVPs."
                  count={addressBook.contacts.length}
                  scroll
                >
                  <AddressBookPanel
                    contacts={addressBook.contacts}
                    groupsByContact={addressBook.groupsByContact}
                  />
                </SettingsSection>

                <SettingsSection
                  title="Contact Groups"
                  description="The audience unit for publishing teaching slots."
                  count={addressBook.groups.length}
                >
                  <ContactGroupsPanel groups={addressBook.groups} />
                </SettingsSection>

                {orgAdminAccess ? (
                  <>
                    <SettingsSection
                      title="API Tokens"
                      description="Org-scoped bearer tokens for the public API."
                      count={apiTokens.length}
                    >
                      <ApiTokensPanel tokens={apiTokens} />
                    </SettingsSection>

                    <SettingsSection
                      title="Webhooks"
                      description="Signed event deliveries to your endpoints."
                      count={webhookData.endpoints.length}
                      scroll
                    >
                      <WebhooksPanel
                        endpoints={webhookData.endpoints}
                        deliveries={webhookData.deliveries}
                      />
                    </SettingsSection>

                    {rotaAdmin ? (
                      <SettingsSection
                        title="Rota availability"
                        description="Suggest excusals from the department rota. Off until a DPIA reference and privacy notice are confirmed."
                      >
                        {rotaAdmin.ok ? (
                          <div className="space-y-6">
                            <RotaSettingsPanel state={rotaAdmin.data} />
                            <div className="border-t border-black pt-6">
                              <h3 className="mb-3 font-mono text-sm font-bold uppercase tracking-wider text-gray-500">
                                Rota uploaders
                              </h3>
                              <RotaUploadersPanel state={rotaAdmin.data} timeZone={appTimeZone()} />
                            </div>
                            {rotaAdmin.data.settings?.enabled && !rotaAdmin.data.cleanupOnly ? (
                              <Link href="/rota" className="inline-block font-mono text-sm underline">
                                Go to rota upload →
                              </Link>
                            ) : null}
                          </div>
                        ) : (
                          <p className="font-mono text-sm text-gray-600">{rotaAdmin.message}</p>
                        )}
                      </SettingsSection>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-4">
              {departmentSettings.map(({ department, settings, members }) => (
                <SettingsSection
                  key={department.id}
                  title={department.name}
                  description={
                    orgManager
                      ? 'Department name, the public feedback form, and certificate coordinators. Members are managed under Organization Members above.'
                      : 'Department name, members, the public feedback form, and certificate coordinators.'
                  }
                >
                  <div className="space-y-6">
                    <DepartmentNamePanel
                      departmentId={department.id}
                      initialName={department.name}
                    />

                    {/* Org managers already have the full member list above —
                        showing it again per department read as duplication. */}
                    {!orgManager ? (
                      <div className="border-t border-black pt-6">
                        <h3 className="mb-3 font-mono text-sm font-bold uppercase tracking-wider text-gray-500">
                          Members
                        </h3>
                        <div className="max-h-80 overflow-y-auto pr-1">
                          <DepartmentMembersPanel
                            departmentId={department.id}
                            departmentName={department.name}
                            members={members}
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="border-t border-black pt-6">
                      <FeedbackTemplatePanel
                        departmentId={department.id}
                        initialFields={settings.feedbackFormFields}
                      />
                    </div>

                    <div className="border-t border-black pt-6">
                      <CertificateSettingsPanel
                        departmentId={department.id}
                        initialCoordinatorNames={settings.coordinatorNames}
                      />
                    </div>
                  </div>
                </SettingsSection>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
