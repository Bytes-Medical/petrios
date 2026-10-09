import { CompliancePage, ComplianceSection, MissingDisclosure } from '@/components/CompliancePage'
import { StatusChip } from '@/components/hud/StatusChip'
import s from '@/components/hud/hud.module.css'
import { getComplianceConfig } from '@/lib/compliance'
import { complianceSectionId } from '@/lib/compliance-sections'

export const metadata = {
  title: 'Subprocessors and external services — Petrios',
  description: 'Deployment-aware register of services that may process Petrios data.',
}

export const dynamic = 'force-dynamic'

const SECTIONS = [
  'Current service register',
  'Operator obligations',
  'Changes and objections',
] as const

type ServiceTone = 'ok' | 'off' | 'attention'

/** `tone` is passed explicitly; descriptive statuses have none and render as plain text. */
function ServiceRow({
  service,
  purpose,
  data,
  status,
  tone,
}: {
  service: string
  purpose: string
  data: string
  status: string
  tone?: ServiceTone
}) {
  return (
    <tr>
      <th scope="row">{service}</th>
      <td>{purpose}</td>
      <td>{data}</td>
      <td>
        {tone ? (
          <StatusChip kind={tone} wrap>
            {status}
          </StatusChip>
        ) : (
          status
        )}
      </td>
    </tr>
  )
}

export default function SubprocessorsPage() {
  const config = getComplianceConfig()
  const emailDeclared = !config.emailProvider.startsWith('No ')
  const speech: { status: string; tone: ServiceTone } = config.speechConfigurationError
    ? { status: 'Configuration incomplete', tone: 'attention' }
    : config.speechEnabled
      ? { status: 'Enabled', tone: 'ok' }
      : { status: 'Disabled', tone: 'off' }

  return (
    <CompliancePage
      title="Subprocessors and external services"
      description="This deployment-aware register names the service categories Petrios can use. Whether a provider is legally a processor, independent controller, or merely disabled depends on the operator’s contract and configuration."
      sections={SECTIONS}
      contents="stacked"
    >
      <ComplianceSection title={SECTIONS[0]} wide>
        {/* Focusable so keyboard users can scroll the register sideways where it overflows (viewports under 876px) */}
        <div
          className={s.registerWrap}
          role="region"
          aria-labelledby={complianceSectionId(SECTIONS[0])}
          tabIndex={0}
        >
          <table className={`${s.register} min-w-[760px]`}>
            <caption>Petrios subprocessors and external services</caption>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Purpose</th>
                <th scope="col">Potential data</th>
                <th scope="col">Deployment status</th>
              </tr>
            </thead>
            <tbody>
              <ServiceRow service="Supabase" purpose="Postgres database, authentication, and private session-document storage" data="Account, organisation, teaching/document, attendance, feedback, certificate, portfolio, delivery, communication, and audit data" status="Core service; operator chooses project and region" />
              <ServiceRow service={config.hostingProvider} purpose="Runs the Petrios web application" data="Requests, IP/network metadata, session cookies, and server logs; application data in transit" status="Configured application host" />
              <ServiceRow service={config.emailProvider} purpose="Sends authentication and operational email" data="Recipient, sender, subject/body, delivery metadata, and attachments where applicable" status={emailDeclared ? 'Configured' : 'Not declared'} tone={emailDeclared ? 'ok' : 'attention'} />
              <ServiceRow service={config.aiProvider} purpose="Optional LLM, private learning-document processing, and provider-hosted authoritative web research" data="Purpose-limited session metadata, assistant messages, processed feedback, private PDF/DOCX/PPTX contents sent on moderator recap generation, document-derived search queries, public result URLs/titles, and generated recap scripts" status={config.aiEnabled ? 'Enabled' : 'Disabled'} tone={config.aiEnabled ? 'ok' : 'off'} />
              <ServiceRow service={config.speechProvider} purpose="Optional text-to-speech for moderator-reviewed Audio Recaps" data="The current draft recap script and speech-generation request metadata; the speech step does not receive uploaded document files or research queries" status={speech.status} tone={speech.tone} />
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

      <ComplianceSection title={SECTIONS[1]}>
        <p>
          Before production use, the operator must reconcile this runtime-derived list with signed
          contracts, provider dashboards, support and monitoring tools, DNS/CDN services, backup
          destinations, and any organisation-added integrations. It must record legal entity,
          service location, processing purpose, data categories, retention, security measures,
          transfer mechanism, DPA link, and effective date for each recipient.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[2]}>
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
