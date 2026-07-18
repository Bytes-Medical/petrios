import { headers } from 'next/headers'
import { CompliancePage, ComplianceSection, MissingDisclosure } from '@/components/CompliancePage'
import { getComplianceConfig } from '@/lib/compliance'

export const metadata = {
  title: 'Your privacy choices — Petrios',
  description: 'Petrios sale, sharing, tracking, and Global Privacy Control information.',
}

export const dynamic = 'force-dynamic'

export default async function PrivacyChoicesPage() {
  const requestHeaders = await headers()
  const gpcEnabled = requestHeaders.get('sec-gpc') === '1'
  const config = getComplianceConfig()

  return (
    <CompliancePage
      title="Your privacy choices"
      description="Do Not Sell or Share My Personal Information — Petrios does not sell personal information or share it for cross-context behavioural advertising."
    >
      <ComplianceSection title="Sale, sharing, and advertising">
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

      <ComplianceSection title="Global Privacy Control">
        <p>
          Global Privacy Control status for this request:{' '}
          <strong>{gpcEnabled ? 'detected (Sec-GPC: 1)' : 'not detected'}</strong>.
          Petrios recognises the signal. Its default no-sale/no-sharing posture already applies
          whether or not the signal is present, so receiving the signal does not require additional
          tracking or an identity cookie.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Make a privacy request">
        <p>
          Requests to know, access, correct, delete, restrict, or object must go to the controller
          for this deployment. Contact:{' '}
          {config.privacyEmail ? (
            <a className="underline hover:text-clay-700" href={`mailto:${config.privacyEmail}`}>
              {config.privacyEmail}
            </a>
          ) : (
            <MissingDisclosure>privacy request email</MissingDisclosure>
          )}.
        </p>
      </ComplianceSection>
    </CompliancePage>
  )
}
