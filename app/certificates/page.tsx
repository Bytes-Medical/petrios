import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getMyCertificates } from '@/app/actions/certificates'
import Link from 'next/link'

export default async function CertificatesPage() {
  const user = await getCurrentUser()
  
  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    redirect('/dashboard')
  }

  const certificates = await getMyCertificates()

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-6 sm:mb-8">My Certificates</h1>

        {certificates.length === 0 ? (
          <Card>
            <p className="font-mono text-sm">No certificates yet.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {certificates.map((cert: any) => (
              <Card key={cert.id}>
                <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg sm:text-xl font-mono font-bold mb-2 break-words">
                      {cert.sessions?.title || 'Unknown Session'}
                    </h2>
                    <div className="font-mono text-sm space-y-1">
                      <p>
                        <strong>Role:</strong> {cert.certificate_role}
                      </p>
                      <p>
                        <strong>Department:</strong> {cert.departments?.name || 'Unknown'}
                      </p>
                      <p>
                        <strong>Date:</strong> {cert.sessions?.date_start ? new Date(cert.sessions.date_start).toLocaleDateString() : 'Unknown'}
                      </p>
                      <p>
                        <strong>Issued:</strong> {new Date(cert.issued_at).toLocaleDateString('en-GB')}
                      </p>
                      <p>
                        <strong>Certificate Code:</strong> {cert.certificate_code}
                      </p>
                      <p>
                        <strong>Status:</strong>{' '}
                        {cert.status === 'REVOKED'
                          ? 'Revoked'
                          : cert.status === 'LEGACY'
                            ? 'Legacy record'
                            : 'Valid'}
                      </p>
                      {cert.status === 'REVOKED' && cert.revocation_reason ? (
                        <p className="text-red-700">
                          <strong>Reason:</strong> {cert.revocation_reason}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-row sm:flex-col gap-2 w-full sm:w-auto">
                    {cert.status !== 'REVOKED' ? (
                      <a
                        href={`/api/certificates/${cert.id}/download`}
                        className="font-mono text-sm underline text-center sm:text-left"
                        target="_blank"
                      >
                        Download PDF
                      </a>
                    ) : null}
                    <Link
                      href={`/verify/${cert.certificate_code}`}
                      className="font-mono text-sm underline text-center sm:text-left"
                      target="_blank"
                    >
                      Verify
                    </Link>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
