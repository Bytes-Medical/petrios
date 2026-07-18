import { CompliancePage, ComplianceSection, MissingDisclosure } from '@/components/CompliancePage'
import { getComplianceConfig } from '@/lib/compliance'

export const metadata = {
  title: 'Data processing agreement framework — Petrios',
  description: 'The Article 28 data-processing terms a hosted Petrios deployment must complete.',
}

export const dynamic = 'force-dynamic'

export default function DataProcessingAgreementPage() {
  const config = getComplianceConfig()

  return (
    <CompliancePage
      title="Data processing agreement framework"
      description="This page is a transparent Article 28 contracting framework, not a signed agreement or legal advice. A controller and processor must complete, review, and execute terms that match their deployment before relying on them."
    >
      <div className="mb-8 border border-gray-300 bg-white p-4 font-mono text-sm leading-relaxed">
        <p><strong>Controller:</strong> {config.controllerName || <MissingDisclosure>legal name</MissingDisclosure>}</p>
        <p><strong>Processor:</strong> <MissingDisclosure>contracting service operator and legal name</MissingDisclosure></p>
        <p><strong>Effective date and term:</strong> <MissingDisclosure>date and service term</MissingDisclosure></p>
      </div>

      <ComplianceSection title="1. Scope and instructions">
        <p>
          The processor may process personal data only on the controller’s documented instructions
          to provide, secure, support, back up, and delete the configured Petrios service. If an
          instruction appears to breach applicable data-protection law, the processor must tell the
          controller unless law prohibits that notice. Processing outside the documented service
          requires a written change agreed by both parties.
        </p>
      </ComplianceSection>

      <ComplianceSection title="2. Processing details">
        <dl className="grid gap-3 border border-gray-300 bg-white p-4 sm:grid-cols-[11rem_1fr]">
          <dt className="font-semibold">Subject matter</dt><dd>Hosting and operation of a teaching-management platform.</dd>
          <dt className="font-semibold">Duration</dt><dd>The service term plus an agreed secure return/deletion period and any legally required retention.</dd>
          <dt className="font-semibold">Nature</dt><dd>Collection, storage, organisation, retrieval, display, communication, analysis, backup, export, restriction, and deletion.</dd>
          <dt className="font-semibold">Purposes</dt><dd>Authentication, teaching administration, attendance evidence, feedback, certificates, portfolio/Recall, communications, reporting, security, and optional AI assistance.</dd>
          <dt className="font-semibold">People</dt><dd>Trainees, faculty, organisers, external teachers, administrators, and support/security contacts.</dd>
          <dt className="font-semibold">Data</dt><dd>Identity/contact, employment/training, membership/role, session/attendance, identified feedback, certificates, reflections, communications, audit, and technical data described in the privacy notice.</dd>
          <dt className="font-semibold">Special data</dt><dd>Not required by design. Free text may nevertheless contain health, welfare, conduct, or other sensitive information and must be treated accordingly.</dd>
        </dl>
      </ComplianceSection>

      <ComplianceSection title="3. Confidentiality and people">
        <p>
          The processor must limit personal-data access to authorised people who need it for the
          service, bind them to confidentiality, train them for their role, promptly remove access
          when no longer needed, and keep a reviewable access process. The controller remains
          responsible for its users, roles, instructions, and the content they enter.
        </p>
      </ComplianceSection>

      <ComplianceSection title="4. Security measures">
        <p>
          Contract schedules should record the deployment’s actual measures, including encryption
          in transit and at rest, Supabase Row Level Security, server-only privileged credentials,
          least-privilege roles, MFA/SSO posture, signed capability links, backups and restore tests,
          vulnerability handling, dependency and secret scanning, security headers, logging,
          incident response, business continuity, deletion controls, and periodic access review.
          Repository features are not evidence that every deployment has configured or tested them.
        </p>
      </ComplianceSection>

      <ComplianceSection title="5. Subprocessors">
        <p>
          The controller gives general authorisation only for subprocessors listed in the public
          register or a signed schedule. The processor must impose materially equivalent
          data-protection duties, remain responsible for their performance, and provide the agreed
          advance notice of additions or replacements so the controller can object on reasonable
          data-protection grounds. The contract must specify the notice channel and objection period.
        </p>
      </ComplianceSection>

      <ComplianceSection title="6. International transfers">
        <p>
          Personal data may leave the UK only on documented instructions and with a valid transfer
          mechanism and assessment where required. Deployment location:{' '}
          {config.hostingRegion || <MissingDisclosure>hosting and backup regions</MissingDisclosure>}.
          Safeguards: {config.transferSafeguards || <MissingDisclosure>applicable transfer mechanism and assessment</MissingDisclosure>}.
        </p>
      </ComplianceSection>

      <ComplianceSection title="7. Rights and compliance assistance">
        <p>
          Taking account of the processing, the processor must provide reasonable technical and
          organisational help with access, correction, deletion, restriction, portability,
          objections, security obligations, breach notifications, DPIAs, regulator consultation,
          and evidence needed for the controller’s accountability. Requests received directly must
          be referred to the controller unless the processor is legally authorised to respond.
        </p>
      </ComplianceSection>

      <ComplianceSection title="8. Personal-data breaches">
        <p>
          The processor must notify the controller without undue delay after becoming aware of a
          personal-data breach and provide available information about its nature, affected people
          and records, likely consequences, containment, remediation, and contact point. The signed
          schedule should define the notification route, severity process, update cadence, and
          evidence preservation without promising facts the incident team does not yet know.
        </p>
      </ComplianceSection>

      <ComplianceSection title="9. Return, deletion, and continuity">
        <p>
          At the controller’s choice and subject to law, the processor must return or securely delete
          personal data after service termination, remove remaining copies on the agreed backup
          cycle, and confirm completion. The schedule must state export format, assistance fees if
          any, backup expiry, certificate/verification record handling, and data that law requires
          either party to retain.
        </p>
      </ComplianceSection>

      <ComplianceSection title="10. Audit and precedence">
        <p>
          The processor must provide information reasonably necessary to demonstrate these duties
          and permit proportionate audits or inspections under agreed confidentiality, security,
          frequency, and cost controls. A signed DPA must identify governing law, liability,
          notices, order of precedence, and any controller-specific instructions. Those negotiated
          terms—not this public framework—form the contract.
        </p>
      </ComplianceSection>
    </CompliancePage>
  )
}
