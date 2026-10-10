import Link from 'next/link'
import {
  CompliancePage,
  ComplianceSection,
  FactList,
  MissingDisclosure,
} from '@/components/CompliancePage'
import { HudLink } from '@/components/hud/HudLink'
import { getComplianceConfig } from '@/lib/compliance'
import { DISPLAY_COOKIE } from '@/lib/public-display'
import { isRotaKillSwitchOn } from '@/lib/rota/config'

export const metadata = {
  title: 'Privacy notice — Petrios',
  description: 'How a Petrios deployment collects, uses, shares, and retains personal data.',
}

export const dynamic = 'force-dynamic'

const SECTIONS = [
  'Who is responsible',
  'Information processed',
  'Why information is used',
  'Lawful basis',
  'Feedback, documents, and AI processing',
  'Rota availability (where enabled)',
  'Cookies and tracking',
  'Recipients and subprocessors',
  'Hosting and international transfers',
  'Retention and deletion',
  'Your rights and complaints',
  'Security and changes',
] as const

export default function PrivacyPolicyPage() {
  const config = getComplianceConfig()
  const rotaAvailable = isRotaKillSwitchOn()

  return (
    <CompliancePage
      title="Privacy notice"
      description="This notice explains the platform’s current data handling. The organisation that operates this Petrios deployment must complete the deployment-specific fields and confirm its lawful basis, retention schedule, and local rights process."
      sections={SECTIONS}
    >
      <ComplianceSection title={SECTIONS[0]}>
        <p>
          Petrios is open-source teaching-management software. The organisation using a deployment
          normally decides why and how personal data is processed and is therefore the controller;
          its hosting and support providers may act as processors.
        </p>
        <FactList
          items={[
            {
              label: 'Controller',
              value: config.controllerName || <MissingDisclosure>controller legal name</MissingDisclosure>,
            },
            {
              label: 'Postal address',
              value: config.controllerAddress || <MissingDisclosure>controller address</MissingDisclosure>,
            },
            {
              label: 'Privacy contact',
              value: config.privacyEmail ? (
                <a href={`mailto:${config.privacyEmail}`}>{config.privacyEmail}</a>
              ) : (
                <MissingDisclosure>privacy or DPO email</MissingDisclosure>
              ),
            },
          ]}
        />
        <p>
          If these details are not declared, contact the organisation that invited you to Petrios
          before submitting a data-rights request. Repository maintainers do not automatically
          control data in independently hosted installations.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[1]}>
        <ul>
          <li><strong>Identity and account:</strong> name, email, training grade, authentication identifiers, profile, and account status.</li>
          <li><strong>Membership and authority:</strong> organisation, department, role, invitations, and teaching assignments.</li>
          <li><strong>Teaching activity:</strong> sessions created, taught, joined, or attended; private session documents; attendance evidence, roster, corrections, and finalized status; teaching slots and claims.</li>
          <li><strong>Address book:</strong> the organisation&apos;s external contacts (names and email addresses, captured automatically from teacher invitations, RSVPs, and slot claims, or added by organisers) and contact groups.</li>
          <li><strong>Feedback:</strong> first name, last name, email, ratings, answers, and free-text comments. The public feedback form does not require an account, but its submissions are <strong>identified, not anonymous</strong>.</li>
          <li><strong>Records and learning:</strong> certificates (including recognition route, recipient, teaching-coordinator, and issuer names), Audio Recap listening progress, Recall attempts/answers/completion, personal reflections, portfolio snapshots, and teaching dossiers.</li>
          <li><strong>Rota availability (only where an organisation switches it on):</strong> a note against each teaching session for which the rota had you unavailable, the moderator&apos;s decision on it, and keyed codes that recognise you in rota uploads; see Rota availability below.</li>
          <li><strong>Communications:</strong> invitation, reminder, notification, newsletter, feedback-release, and delivery status data.</li>
          <li><strong>Operations assistant (only where the operator enables it):</strong> chat threads with the organisers&apos; messages and the assistant&apos;s replies stored as written, plus organisation-wide notes the assistant saves for later conversations.</li>
          <li><strong>Security and technical data:</strong> essential authentication cookies, IP/network data available to infrastructure providers, request and error logs (which can include recipient email addresses), API credentials, audit events, and abuse-prevention signals.</li>
        </ul>
        <p>
          Petrios is not designed for patient records. Users should not enter patient data,
          clinical secrets, or unnecessary special-category data in session descriptions,
          feedback, uploaded session documents, reflections, or assistant messages.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[2]}>
        <p>
          Data is used to authenticate users; administer organisations and departments; schedule
          and deliver teaching; derive attendance from recorded evidence; manage teachers and
          teaching slots; collect and release feedback; issue and verify certificates; build
          subject-requested portfolio records; send operational communications; audit access and
          changes; maintain security; provide optional AI-assisted teaching operations; and, where an
          organisation switches it on, suggest to moderators which absences the rota explains.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[3]}>
        <p>
          The deploying controller must identify and record a lawful basis for each purpose. It
          may rely on public task, contract, legal obligation, legitimate interests, or consent
          depending on its role and context. Petrios does not choose that basis on the controller’s
          behalf. Consent should not be described as the basis where people cannot freely refuse
          or withdraw it.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[4]}>
        <p>
          Raw feedback remains identifiable to authorised moderators. Teacher feedback-release
          emails omit respondent names, email addresses, and raw comments, but may contain aggregate
          ratings and a moderator-reviewed AI summary from the first response. Reports based on fewer
          than five responses are labelled as limited, directional evidence; the teacher may still infer
          who participated. Optional summary paths omit stored identity fields, remove known names where
          detectable, treat comments as untrusted, and route configured welfare or conduct signals to
          human review. These controls do not make the source record anonymous. Free text can itself
          identify a person, so users should avoid unnecessary identifying details.
        </p>
        <p>
          Optional AI features are currently <strong>{config.aiEnabled ? `enabled through ${config.aiProvider}` : 'disabled'}</strong>.
          When enabled, a configured AI provider may receive session metadata (including the names
          of invited teachers, or an invitee&apos;s email address where no name is recorded),
          assistant messages and the records its tools look up, purpose-limited feedback content, and
          private uploaded PDF/DOCX/PPTX learning documents.
          A deliberate Audio Recap request sends the documents for that session; a deliberate weekly
          newsletter request sends all available documents for every teaching session in the selected
          department that ended in the selected week (up to the time of the request). Newsletter generation does not use web search. PDFs may be
          processed as text and page images. Word and PowerPoint files are sent differently by
          provider: an OpenAI-compatible endpoint receives the original file, including any comments,
          tracked changes, headers and footers, embedded images, and document properties such as the
          author; with Anthropic, Petrios sends only the extracted body text and PowerPoint speaker
          notes. For Audio Recap only, the provider&apos;s hosted search may
          issue queries derived from that learning material to retrieve supporting information from a
          restricted list of authoritative public clinical and evidence sources. Petrios records the
          document identifiers and integrity hashes used for recaps and newsletters plus returned
          recap public-source titles and URLs; it does not copy those public pages. Opening a source link contacts that
          external website from your browser. The Ops audit log stores model-run hashes and operational
          metadata rather than raw prompt text or search queries. The provider may retain request and
          search content under its own terms.{' '}
          {config.aiProviderKind === 'anthropic' ? (
            <>
              With Anthropic, each learning document is uploaded to the provider&apos;s file storage
              for one generation only (Word and PowerPoint files as extracted text). Petrios sets the
              upload to expire after one hour and deletes it as soon as the draft is produced or the
              request fails, and a daily clean-up removes anything an interrupted request left behind.
              The stored file has a generated name; the document&apos;s title is sent only with the
              generation request. Anthropic&apos;s commercial terms state that API content is not used
              to train its models; see its{' '}
              <HudLink href="https://www.anthropic.com/legal/commercial-terms">commercial terms</HudLink>{' '}
              and{' '}
              <HudLink href="https://privacy.anthropic.com/">privacy center</HudLink> for how long
              requests, uploaded files, search content, and content flagged for safety review are
              retained. If the provider named above is an operator-configured endpoint, that
              service&apos;s own terms apply instead.
            </>
          ) : config.aiProviderKind === 'openai' ? (
            <>
              OpenAI states that API data is not used to train its models by default, while standard
              abuse-monitoring logs may be retained for up to 30 days; see its{' '}
              <HudLink href="https://developers.openai.com/api/docs/guides/your-data">
                API data controls documentation
              </HudLink>. Petrios asks OpenAI not to keep document requests as stored, retrievable
              responses; that does not change the abuse-monitoring retention. If the provider named
              above is an operator-configured endpoint, that service&apos;s own terms apply instead.
            </>
          ) : null}
        </p>
        <p>
          Audio speech synthesis is currently{' '}
          <strong>
            {config.speechConfigurationError
              ? 'incompletely configured'
              : config.speechEnabled
                ? `enabled through ${config.speechProvider}`
                : 'disabled'}
          </strong>.
          When a moderator creates an audio preview, the selected speech provider receives the
          current draft recap script and request metadata needed to produce the MP3. That separate
          speech request does not contain the uploaded document files, raw feedback, or hosted-search
          queries. Re-creating audio makes another provider request and may consume provider credits.
          The resulting narration is AI-generated, is labelled as such wherever attendees can play
          it, and remains unavailable to attendees until a moderator approves it (moderators are asked
          to listen to it first).
        </p>
        {config.speechEnabled && config.speechProviderKind === 'openai' ? (
          <p>
            This deployment uses OpenAI for speech generation, whichever provider handles the text
            features above. OpenAI states that API data is not used to train its models by default,
            while standard abuse-monitoring logs may be retained for up to 30 days; see its{' '}
            <HudLink href="https://developers.openai.com/api/docs/guides/your-data">
              API data controls documentation
            </HudLink>. If the speech provider named above is an operator-configured endpoint, that
            service&apos;s own terms apply instead.
          </p>
        ) : null}
        {config.speechEnabled && config.speechProviderKind === 'elevenlabs' ? (
          <p>
            This deployment uses ElevenLabs for speech generation. Standard API requests use the
            provider&apos;s configured logging/history posture; zero-retention availability depends on
            the operator&apos;s plan and account configuration. The operator must reconcile retention,
            region, contract, and transfer settings with the{' '}
            <HudLink href="https://elevenlabs.io/docs/api-reference/text-to-speech/convert">
              ElevenLabs API documentation
            </HudLink>.
          </p>
        ) : null}
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[5]}>
        <p>
          Rota availability is{' '}
          <strong>
            {rotaAvailable
              ? 'available on this deployment, and each organisation decides whether to switch it on'
              : 'switched off on this deployment'}
          </strong>
          . An organisation can switch it on only after recording a data protection impact
          assessment reference and confirming that its staff privacy notice has been updated, and
          only for the departments it chooses.
        </p>
        <p>
          Where it is on, your department&apos;s teaching platform, Petrios, receives a limited
          summary of your rota from the e-rostering system of your employing organisation (
          <MissingDisclosure>employing trust</MissingDisclosure>). The rota coordinator prepares the
          summary in their own browser: the export file, shift codes, names, and leave reasons never
          leave that device. The summary gives one status per day: available, on duty elsewhere, on
          nights or post-night rest, not working, or on leave. Petrios uses it at the moment it
          arrives and does not keep it. Your staff number or work email arrives with it only so
          Petrios can recognise you; Petrios stores a keyed code derived from it, never the number or
          address itself, and only after a session moderator has confirmed it is you. Before an
          upload, the staff number or email of every row in the export, including staff who are
          not trainees in the department, is checked once against the department&apos;s trainees
          and is not stored. Petrios keeps
          only a note against each teaching session for which you were rostered unavailable. It
          never receives the reason for leave or any sickness information, and it never records
          which kind of unavailability applied.
        </p>
        <p>
          The note is used only to suggest to the session&apos;s moderator, after the session has
          ended, that your absence be excused. The moderator decides each case individually; nothing
          is excused automatically, and attendance is never finalised from rota data. You can see
          the note for your own sessions at any time and tell Petrios the rota was wrong. Only the
          session&apos;s moderators (its department administrators and your organisation&apos;s
          administrators) and you can see it. If your moderator confirms an excusal, your attendance
          record for that session shows it as excused because you were rostered unavailable, and it
          is kept with your other attendance records. That a suggestion was confirmed, dismissed, or
          contested (never why you were unavailable) is also kept in the session&apos;s activity
          history. Rota information is never used to assess your performance and is not used for
          analytics.
        </p>
        <p>
          Session notes are deleted within the period your organisation sets (30 days unless it
          chooses between 1 and 90 days) after attendance for the session is finalised or its
          catch-up closes, whichever is later, and never later than 90 days after the session. They
          are also deleted when the session is moved or cancelled, when you leave the department, or
          when the organisation switches rota availability off. This does not replace exception
          reporting: please still exception-report missed teaching to your educational supervisor;
          your Director of Medical Education (<MissingDisclosure>DME contact</MissingDisclosure>) can
          also help. The lawful basis is recorded by
          the controller (see Lawful basis above; for NHS employers this is usually public task).
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[6]}>
        <p>
          Petrios uses first-party storage needed to sign a user in and maintain the authenticated
          session. The application does not ship advertising, cross-site behavioural tracking, or
          analytics cookies. A consent banner is therefore not shown. If an operator adds
          non-essential analytics, embeds, or tracking, it must update this notice and obtain any
          consent required before those technologies run.
        </p>
        <p>
          If you choose Night or Match device in the Display control on the public site, a
          first-party cookie named <code>{DISPLAY_COOKIE}</code> remembers that choice on this device
          for up to 6 months. It holds only that setting, is not used to identify you, and is never
          set unless you choose one of those options. Choosing Day deletes it.
        </p>
        <p>
          See <Link href="/privacy/choices">Your privacy choices</Link> for the platform’s sale/share and Global Privacy Control posture.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[7]}>
        <p>
          Authorised users see data according to their role. Infrastructure, email, meeting, and
          optional AI providers process only the data needed for their service. The current
          deployment-facing register is published on the{' '}
          <Link href="/subprocessors">subprocessors and external services page</Link>.
          Data may also be disclosed where legally required or necessary to protect people and the service.
        </p>
        <p>
          Petrios Meet video rooms: <strong>{config.meetingProvider}</strong>.{' '}
          {config.meetingConfigurationError
            ? 'Video rooms are closed until the operator completes the meeting configuration, so no meeting data is shared.'
            : config.meetingProviderKind === 'public'
              ? 'Petrios sends no data to meet.jit.si. A participant who opens the room link joins meet.jit.si directly under Jitsi’s own terms; the person who starts the room signs in to Jitsi, and the name you enter there, your audio, video, chat, and screen sharing are handled by that service.'
              : config.meetingRoomPass
                ? 'When you join, the provider receives a short-lived room pass with your display name (your profile name, or the name on a teacher invitation; never your email address), a pseudonymous participant id that is different for every session, and whether you moderate the room, plus the room name, the session title, and the audio, video, chat, and screen sharing exchanged in the room.'
                : 'When you join, the provider receives the display name pre-filled from your profile name (never your email address, and editable before joining), the room name, the session title, and the audio, video, chat, and screen sharing exchanged in the room.'}
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[8]}>
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

      <ComplianceSection title={SECTIONS[9]}>
        <p>
          Petrios does not currently enforce one universal automatic retention schedule. The
          controller must set and document periods for accounts, membership, attendance evidence,
          feedback, private session documents, delivery ledgers, communications, audit data,
          certificates, portfolio records, and provider logs,
          then implement deletion or anonymisation operations appropriate to those periods.
          Attendance evidence is append-only in normal application/RLS flows, corrections are new
          reasoned rows, and public verification or archived document records need separate
          revocation, deletion, and retention decisions. Rota availability notes are the exception:
          Petrios deletes them automatically on the schedule described under Rota availability.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[10]}>
        <p>
          Depending on the applicable law, people may have rights to information, access,
          correction, deletion, restriction, objection, portability, and review of certain automated
          decisions. Submit a request to the controller named above; it may need to verify identity
          and may apply lawful exemptions. UK users may also complain to the Information
          Commissioner’s Office or seek a judicial remedy.
        </p>
      </ComplianceSection>

      <ComplianceSection title={SECTIONS[11]}>
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
