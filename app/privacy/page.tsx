import Link from 'next/link'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Privacy Policy — Byte Teaching',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-mono text-lg font-bold">{title}</h2>
      <div className="space-y-2 font-mono text-sm leading-relaxed text-gray-700">{children}</div>
    </section>
  )
}

export default function PrivacyPolicyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <Link href="/" className="font-mono text-sm underline">
            ← Home
          </Link>
          <h1 className="mt-4 font-mono text-2xl font-bold sm:text-3xl">Privacy Policy</h1>
          <p className="mt-2 font-mono text-xs text-gray-500">Last updated: 25 May 2026</p>

          <div className="mt-4 border border-black bg-gray-50 p-3 font-mono text-xs text-gray-700">
            ⚠️ Template — review with a data protection adviser / DPO before publishing. It
            describes how the platform currently handles data but is not legal advice.
          </div>

          <div className="mt-8">
            <Section title="Who we are">
              <p>
                Byte Teaching is a teaching-management platform for NHS educators and trainees. It
                lets organisers schedule teaching sessions, record attendance, collect feedback,
                issue certificates, and build teaching slides.
              </p>
            </Section>

            <Section title="Information we collect">
              <ul className="list-disc space-y-1 pl-5">
                <li><strong>Account details</strong> — email address, and (where provided) name and grade.</li>
                <li><strong>Membership</strong> — the organisation and department(s) you belong to and your role.</li>
                <li><strong>Teaching activity</strong> — sessions you create or attend, and attendance evidence (QR/group-code check-ins, teacher confirmations).</li>
                <li><strong>Feedback</strong> — session feedback, which is collected anonymously.</li>
                <li><strong>Certificates</strong> — records of certificates issued to teachers and attendees.</li>
                <li><strong>Content you create</strong> — presentations/slides, including any images you upload.</li>
                <li><strong>Technical data</strong> — a session cookie used to keep you signed in.</li>
              </ul>
            </Section>

            <Section title="How we use your information">
              <p>
                To provide the service: authenticate you, organise teaching, track attendance,
                generate certificates, share feedback reports, and send you sign-in links and
                session-related emails. We do not sell your data or use it for advertising.
              </p>
            </Section>

            <Section title="Legal basis (UK GDPR)">
              <p>
                We process personal data to perform our service to you and your organisation
                (contract), and on the basis of legitimate interests in running an education
                platform. Where required, processing relies on your consent, which you may withdraw.
              </p>
            </Section>

            <Section title="Sharing &amp; processors">
              <p>We share data only with processors that help us run the service:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong>Supabase</strong> — database, authentication, and file storage.</li>
                <li><strong>MailerSend</strong> — sending sign-in and notification emails.</li>
              </ul>
              <p>We may disclose data where required by law.</p>
            </Section>

            <Section title="Image uploads">
              <p>
                Images you upload to slides are stored in a publicly-readable storage bucket so they
                can be displayed and presented. Do not upload patient-identifiable information or
                confidential images.
              </p>
            </Section>

            <Section title="Retention">
              <p>
                We keep personal data for as long as your account and your organisation&rsquo;s
                records are active, and as needed to meet legal or training-record obligations.
                Contact us to request deletion.
              </p>
            </Section>

            <Section title="Your rights">
              <p>
                Under UK GDPR you can request access to, correction of, or deletion of your personal
                data, object to or restrict processing, and request portability. To exercise these
                rights, contact us using the details below.
              </p>
            </Section>

            <Section title="Security">
              <p>
                Access is controlled by role-based permissions and row-level security. Connections
                are encrypted in transit. No system is perfectly secure; please use a strong, unique
                email account.
              </p>
            </Section>

            <Section title="Changes">
              <p>
                We may update this policy; material changes will be reflected by the &ldquo;last
                updated&rdquo; date above.
              </p>
            </Section>

            <Section title="Contact">
              <p>
                Questions or data requests: contact your organisation&rsquo;s administrator or the
                Byte Teaching team at{' '}
                <a href="mailto:privacy@byteteaching.example" className="underline">
                  privacy@byteteaching.example
                </a>
                . (Update this address before publishing.)
              </p>
            </Section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
