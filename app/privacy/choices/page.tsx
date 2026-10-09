import { headers } from 'next/headers'
import { CompliancePage, ComplianceSection, MissingDisclosure } from '@/components/CompliancePage'
import { StatusChip } from '@/components/hud/StatusChip'
import { getComplianceConfig } from '@/lib/compliance'

export const metadata = {
  title: 'Your privacy choices — Petrios',
  description: 'Petrios sale, sharing, tracking, and Global Privacy Control information.',
}

export const dynamic = 'force-dynamic'

const SECTIONS = [
  'Sale, sharing, and advertising',
  'Global Privacy Control',
  'Make a privacy request',
] as const

export default async function PrivacyChoicesPage() {
  const requestHeaders = await headers()
  const gpcEnabled = requestHeaders.get('sec-gpc') === '1'
  const config = getComplianceConfig()

  return (
    <CompliancePage
      title="Your privacy choices"
      description="Do Not Sell or Share My Personal Information — Petrios does not sell personal information or share it for cross-context behavioural advertising."
      sections={SECTIONS}
    >
      <ComplianceSection title={SECTIONS[0]}>
        <p>
          The Petrios application does not include advertising technology, data-broker integrations,
          or cross-site behavioural tracking. It does not sell personal information or share it for
          cross-context behavioural advertising. Because those activities do not occur, there is no
          sale/share state to switch off and no account is required to express this choice.
        </p>
        <p>
          An operator that adds advertising, analytics, or tracking is responsible for implementing
          consent and opt-out controls before deployment and for updating these disclosures.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[1]}>
        <p>
          Global Privacy Control status for this request:{' '}
          <StatusChip kind={gpcEnabled ? 'ok' : 'off'}>{gpcEnabled ? 'detected (Sec-GPC: 1)' : 'not detected'}</StatusChip>.
          Petrios recognises the signal. Its default no-sale/no-sharing posture already applies
          whether or not the signal is present, so receiving the signal does not require additional
          tracking or an identity cookie.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[2]}>
        <p>
          Requests to know, access, correct, delete, restrict, or object must go to the controller
          for this deployment. Contact:{' '}
          {config.privacyEmail ? (
            <a href={`mailto:${config.privacyEmail}`}>{config.privacyEmail}</a>
          ) : (
            <MissingDisclosure>privacy request email</MissingDisclosure>
          )}.
        </p>
      </ComplianceSection>
    </CompliancePage>
  )
}
