import { getCertificateByCode } from '@/app/actions/certificates'
import { buildSignatories } from '@/lib/certificates/signatories'
import Image from 'next/image'
import { Wordmark } from '@/components/Wordmark'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'

export default async function VerifyCertificatePage(
  props: {
    params: Promise<{ certificateId: string }>
  }
) {
  const params = await props.params;
  const certificate = await getCertificateByCode(params.certificateId)
  const revoked = certificate?.status === 'REVOKED'
  const legacy = certificate?.status === 'LEGACY'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="max-w-lg w-full">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Wordmark />
        </div>

        {certificate ? (
          <div className="border border-black bg-white">
            <div className={`${revoked ? 'bg-red-50 border-red-200' : legacy ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'} border-b px-6 py-4`}>
              <div className="flex items-center gap-2">
                <span className={`${revoked ? 'text-red-600' : legacy ? 'text-amber-700' : 'text-green-600'} text-xl`}>
                  {revoked ? <>&#10007;</> : legacy ? '!' : <>&#10003;</>}
                </span>
                <span className={`${revoked ? 'text-red-800' : legacy ? 'text-amber-900' : 'text-green-800'} font-mono text-sm font-bold`}>
                  {revoked ? 'Revoked Certificate' : legacy ? 'Legacy Certificate Record' : 'Valid Certificate'}
                </span>
              </div>
              {revoked ? (
                <p className="mt-2 font-mono text-xs text-red-800">
                  This code is retained for audit history but is no longer valid.
                  {certificate.revocation_reason ? ` ${certificate.revocation_reason}.` : ''}
                </p>
              ) : legacy ? (
                <p className="mt-2 font-mono text-xs text-amber-900">
                  This certificate predates the finalized-attendance eligibility gate.
                </p>
              ) : null}
            </div>

            {/* Certificate ID */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <p className="font-mono text-xs text-gray-500 uppercase tracking-wider">
                Certificate ID
              </p>
              <p className="font-mono text-lg font-bold tracking-[0.2em] mt-1">
                {certificate.certificate_code}
              </p>
            </div>

            {/* Details */}
            <div className="px-6 py-5 space-y-4">
              {certificate.recipient_name && (
                <Detail label="Recipient" value={certificate.recipient_name} />
              )}
              <Detail
                label="Role"
                value={certificate.certificate_role === 'TEACHER' ? 'Teacher' : 'Attendee'}
              />
              <Detail
                label="Session"
                value={certificate.sessions?.title || 'Unknown'}
              />
              {certificate.sessions?.date_start && (
                <Detail
                  label="Session Date"
                  value={new Date(certificate.sessions.date_start).toLocaleDateString(
                    'en-GB',
                    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
                  )}
                />
              )}
              {certificate.departments?.name && (
                <Detail label="Department" value={certificate.departments.name} />
              )}
              {certificate.organizations?.name && (
                <Detail label="Organisation" value={certificate.organizations.name} />
              )}
              {buildSignatories({
                coordinatorNames: resolveTeachingCoordinatorNames(
                  certificate.coordinator_names,
                  certificate.departments?.lead_name
                ),
                issuerName: certificate.issued_by_name,
              }).map((s) => (
                <Detail key={`${s.label}-${s.value}`} label={s.label} value={s.value} />
              ))}
              <Detail
                label="Issued"
                value={new Date(certificate.issued_at).toLocaleDateString(
                  'en-GB',
                  { day: 'numeric', month: 'long', year: 'numeric' }
                )}
              />
            </div>
          </div>
        ) : (
          <div className="border border-black bg-white">
            <div className="bg-red-50 border-b border-red-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <span className="text-red-600 text-xl">&#10007;</span>
                <span className="font-mono text-sm font-bold text-red-800">
                  Certificate Not Found
                </span>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="font-mono text-sm text-gray-600">
                The certificate code <strong className="tracking-wider">{params.certificateId}</strong> could not be verified. Please check the code and try again.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="font-mono text-sm font-bold mt-0.5">{value}</p>
    </div>
  )
}
