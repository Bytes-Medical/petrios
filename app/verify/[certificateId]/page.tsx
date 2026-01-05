import { getCertificateByCode } from '@/app/actions/certificates'
import { Card } from '@/components/Card'

export default async function VerifyCertificatePage({
  params,
}: {
  params: { certificateId: string }
}) {
  const certificate = await getCertificateByCode(params.certificateId)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="max-w-2xl w-full">
        <Card>
          {certificate ? (
            <div>
              <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-6 sm:mb-8">Certificate Verification</h1>
              <div className="space-y-4 font-mono text-sm">
                <div className="p-4 border border-green-500 bg-green-50">
                  <p className="font-bold text-green-800">✓ Valid Certificate</p>
                </div>
                <div className="space-y-2">
                  <p><strong>Certificate Code:</strong> {certificate.certificate_code}</p>
                  <p><strong>Session:</strong> {certificate.sessions?.title || 'Unknown'}</p>
                  <p><strong>Department:</strong> {certificate.departments?.name || 'Unknown'}</p>
                  <p><strong>Role:</strong> {certificate.certificate_role}</p>
                  <p><strong>Issued:</strong> {new Date(certificate.issued_at).toLocaleDateString()}</p>
                  {certificate.sessions?.date_start && (
                    <p><strong>Session Date:</strong> {new Date(certificate.sessions.date_start).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-6 sm:mb-8">Certificate Verification</h1>
              <div className="p-4 border border-red-500 bg-red-50">
                <p className="font-bold text-red-800">✗ Invalid Certificate</p>
                <p className="font-mono text-sm text-red-700 mt-2">
                  The certificate code "{params.certificateId}" was not found.
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
