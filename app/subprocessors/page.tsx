import { CompliancePage, ComplianceSection, MissingDisclosure } from '@/components/CompliancePage'
import { getComplianceConfig } from '@/lib/compliance'

export const metadata = {
  title: 'Subprocessors and external services — Petrios',
  description: 'Deployment-aware register of services that may process Petrios data.',
}

export const dynamic = 'force-dynamic'

function ServiceRow({
  service,
  purpose,
  data,
  status,
}: {
  service: string
  purpose: string
  data: string
  status: string
}) {
  return (
    <tr className="border-b border-gray-300 align-top last:border-0">
      <th scope="row" className="p-3 text-left font-semibold">{service}</th>
      <td className="p-3">{purpose}</td>
      <td className="p-3">{data}</td>
      <td className="p-3">{status}</td>
    </tr>
  )
}

export default function SubprocessorsPage() {
  const config = getComplianceConfig()

  return (
    <CompliancePage
      title="Subprocessors and external services"
      description="This deployment-aware register names the service categories Petrios can use. Whether a provider is legally a processor, independent controller, or merely disabled depends on the operator’s contract and configuration."
    >
      <ComplianceSection title="Current service register">
        <div className="overflow-x-auto border border-gray-300 bg-white">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <caption className="sr-only">Petrios subprocessors and external services</caption>
            <thead className="border-b border-black bg-gray-100">
              <tr>
                <th scope="col" className="p-3">Service</th>
                <th scope="col" className="p-3">Purpose</th>
                <th scope="col" className="p-3">Potential data</th>
                <th scope="col" className="p-3">Deployment status</th>
              </tr>
            </thead>
            <tbody>
              <ServiceRow service="Supabase" purpose="Postgres database and authentication" data="Account, organisation, teaching, feedback, certificate, portfolio, communication, and audit data" status="Core service; operator chooses project and region" />
              <ServiceRow service={config.hostingProvider} purpose="Runs the Petrios web application" data="Requests, IP/network metadata, session cookies, and server logs; application data in transit" status="Configured application host" />
              <ServiceRow service={config.emailProvider} purpose="Sends authentication and operational email" data="Recipient, sender, subject/body, delivery metadata, and attachments where applicable" status={config.emailProvider.startsWith('No ') ? 'Not declared' : 'Configured'} />
              <ServiceRow service={config.aiProvider} purpose="Optional LLM and text-to-speech processing" data="Purpose-limited session metadata, assistant messages, processed feedback, and approved recap text" status={config.aiEnabled ? 'Enabled' : 'Disabled'} />
              <ServiceRow service={config.meetingProvider} purpose="Optional live video rooms" data="Participant-provided meeting identity and audio/video exchanged directly with the Jitsi service" status="Available when a user opens a video room" />
            </tbody>
          </table>
        </div>
        <p>
          Primary data/backup region:{' '}
          {config.hostingRegion || <MissingDisclosure>region(s) for database, app host, and backups</MissingDisclosure>}.
          International-transfer safeguards:{' '}
          {config.transferSafeguards || <MissingDisclosure>provider-specific transfer safeguards</MissingDisclosure>}.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Operator obligations">
        <p>
          Before production use, the operator must reconcile this runtime-derived list with signed
          contracts, provider dashboards, support and monitoring tools, DNS/CDN services, backup
          destinations, and any organisation-added integrations. It must record legal entity,
          service location, processing purpose, data categories, retention, security measures,
          transfer mechanism, DPA link, and effective date for each recipient.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Changes and objections">
        <p>
          This open-source application cannot notify people when an independent operator changes
          infrastructure. Each operator must define its own advance-notice channel and objection
          process in its executed data-processing agreement. Repository changes that introduce a
          new built-in external data flow must update this register, the privacy notice, environment
          contract, and relevant subsystem specification in the same change.
        </p>
      </ComplianceSection>
    </CompliancePage>
  )
}
