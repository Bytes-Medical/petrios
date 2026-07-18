import Link from 'next/link'
import {
  CompliancePage,
  ComplianceSection,
  MissingDisclosure,
} from '@/components/CompliancePage'
import { getComplianceConfig } from '@/lib/compliance'

export const metadata = {
  title: 'Privacy notice — Petrios',
  description: 'How a Petrios deployment collects, uses, shares, and retains personal data.',
}

export const dynamic = 'force-dynamic'

export default function PrivacyPolicyPage() {
  const config = getComplianceConfig()

  return (
    <CompliancePage
      title="Privacy notice"
      description="This notice explains the platform’s current data handling. The organisation that operates this Petrios deployment must complete the deployment-specific fields and confirm its lawful basis, retention schedule, and local rights process."
    >
      <ComplianceSection title="Who is responsible">
        <p>
          Petrios is open-source teaching-management software. The organisation using a deployment
          normally decides why and how personal data is processed and is therefore the controller;
          its hosting and support providers may act as processors.
        </p>
        <dl className="grid gap-2 border border-gray-300 bg-white p-4 sm:grid-cols-[12rem_1fr]">
          <dt className="font-semibold">Controller</dt>
          <dd>{config.controllerName || <MissingDisclosure>controller legal name</MissingDisclosure>}</dd>
          <dt className="font-semibold">Postal address</dt>
          <dd>{config.controllerAddress || <MissingDisclosure>controller address</MissingDisclosure>}</dd>
          <dt className="font-semibold">Privacy contact</dt>
          <dd>
            {config.privacyEmail ? (
              <a className="underline hover:text-clay-700" href={`mailto:${config.privacyEmail}`}>
                {config.privacyEmail}
              </a>
            ) : (
              <MissingDisclosure>privacy or DPO email</MissingDisclosure>
            )}
          </dd>
        </dl>
        <p>
          If these details are not declared, contact the organisation that invited you to Petrios
          before submitting a data-rights request. Repository maintainers do not automatically
          control data in independently hosted installations.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Information processed">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Identity and account:</strong> name, email, training grade, authentication identifiers, profile, and account status.</li>
          <li><strong>Membership and authority:</strong> organisation, department, role, invitations, and teaching assignments.</li>
          <li><strong>Teaching activity:</strong> sessions created, taught, joined, or attended; attendance evidence and derived status; teaching slots and claims.</li>
          <li><strong>Feedback:</strong> first name, last name, email, ratings, answers, and free-text comments. The public feedback form does not require an account, but its submissions are <strong>identified, not anonymous</strong>.</li>
          <li><strong>Records and learning:</strong> certificates, Recall answers, personal reflections, curriculum coverage, portfolio snapshots, and teaching dossiers.</li>
          <li><strong>Communications:</strong> invitation, reminder, notification, newsletter, feedback-release, and delivery status data.</li>
          <li><strong>Security and technical data:</strong> essential authentication cookies, IP/network data available to infrastructure providers, request and error logs, API credentials, audit events, and abuse-prevention signals.</li>
        </ul>
        <p>
          Petrios is not designed for patient records. Users should not enter patient data,
          clinical secrets, or unnecessary special-category data in session descriptions,
          feedback, reflections, or assistant messages.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Why information is used">
        <p>
          Data is used to authenticate users; administer organisations and departments; schedule
          and deliver teaching; derive attendance from recorded evidence; manage teachers and
          teaching slots; collect and release feedback; issue and verify certificates; build
          subject-requested portfolio records; send operational communications; audit access and
          changes; maintain security; and provide optional AI-assisted teaching operations.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Lawful basis">
        <p>
          The deploying controller must identify and record a lawful basis for each purpose. It
          may rely on public task, contract, legal obligation, legitimate interests, or consent
          depending on its role and context. Petrios does not choose that basis on the controller’s
          behalf. Consent should not be described as the basis where people cannot freely refuse
          or withdraw it.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Feedback and AI processing">
        <p>
          Raw feedback remains identifiable to authorised moderators, and teacher feedback-release
          emails currently include the submitter’s name. Some AI paths omit stored identity fields
          and the Ops synthesis path removes known names and quarantines welfare or conduct signals;
          that processing does not make the source record anonymous. Free text can itself identify
          a person, so users should avoid unnecessary identifying details.
        </p>
        <p>
          Optional AI features are currently <strong>{config.aiEnabled ? `enabled through ${config.aiProvider}` : 'disabled'}</strong>.
          When enabled, a configured AI provider may receive session metadata, assistant messages,
          and purpose-limited feedback content. Petrios stores model-run hashes and operational
          metadata rather than prompt text in its Ops audit log, but the provider may retain request
          content under its own terms. OpenAI states that API data is not used to train its models
          by default, while standard abuse-monitoring logs may be retained for up to 30 days; see
          its{' '}
          <a
            className="underline hover:text-clay-700"
            href="https://developers.openai.com/api/docs/guides/your-data"
          >
            API data controls documentation
          </a>.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Cookies and tracking">
        <p>
          Petrios uses first-party storage needed to sign a user in and maintain the authenticated
          session. The application does not ship advertising, cross-site behavioural tracking, or
          analytics cookies. A consent banner is therefore not shown. If an operator adds
          non-essential analytics, embeds, or tracking, it must update this notice and obtain any
          consent required before those technologies run.
        </p>
        <p>
          See <Link className="underline hover:text-clay-700" href="/privacy/choices">Your privacy choices</Link> for the platform’s sale/share and Global Privacy Control posture.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Recipients and subprocessors">
        <p>
          Authorised users see data according to their role. Infrastructure, email, meeting, and
          optional AI providers process only the data needed for their service. The current
          deployment-facing register is published on the{' '}
          <Link className="underline hover:text-clay-700" href="/subprocessors">subprocessors and external services page</Link>.
          Data may also be disclosed where legally required or necessary to protect people and the service.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Hosting and international transfers">
        <p>
          Application host: <strong>{config.hostingProvider}</strong>. Data-hosting location:{' '}
          {config.hostingRegion || <MissingDisclosure>database and application region(s)</MissingDisclosure>}.
        </p>
        <p>
          Transfer safeguard: {config.transferSafeguards || <MissingDisclosure>adequacy decision, UK IDTA/Addendum, or other applicable safeguard</MissingDisclosure>}.
          The controller must evaluate every configured provider and onward transfer; “self-hosted”
          does not by itself prove that all data remains in one country or estate.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Retention and deletion">
        <p>
          Petrios does not currently enforce one universal automatic retention schedule. The
          controller must set and document periods for accounts, membership, attendance evidence,
          feedback, communications, audit data, certificates, portfolio records, and provider logs,
          then implement deletion or anonymisation operations appropriate to those periods.
          Attendance evidence is append-oriented in normal application flows, and public verification
          records may need separate revocation and retention decisions.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Your rights and complaints">
        <p>
          Depending on the applicable law, people may have rights to information, access,
          correction, deletion, restriction, objection, portability, and review of certain automated
          decisions. Submit a request to the controller named above; it may need to verify identity
          and may apply lawful exemptions. UK users may also complain to the Information
          Commissioner’s Office or seek a judicial remedy.
        </p>
      </ComplianceSection>

      <ComplianceSection title="Security and changes">
        <p>
          Petrios uses role checks, organisation scoping, Supabase Row Level Security, server-only
          privileged access, signed capability links, security headers, and automated code,
          dependency, migration, and secret scanning. No service can promise absolute security.
          Report vulnerabilities privately using the process in the project’s SECURITY.md.
        </p>
        <p>
          Material notice changes will update the date above. The controller should tell affected
          people directly when a change materially affects their processing or choices.
        </p>
      </ComplianceSection>
    </CompliancePage>
  )
}
