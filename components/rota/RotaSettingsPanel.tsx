'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { useToast } from '@/components/ToastProvider'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import { disableRota, enableRota, saveRotaGovernance, setRotaDepartmentEnrolment } from '@/app/actions/rota-admin'
import type { RotaAdminState } from '@/lib/rota/types'

/**
 * Org-admin rota governance (spec/14): DPIA reference, privacy-notice
 * confirmation, retention and horizon, then enable; department enrolment;
 * and the typed "DISABLE" hard switch-off (deletes every flag and link).
 * In cleanup-only mode (the kill switch is off but rota data is still
 * stored) only the deletion controls are shown.
 */
export function RotaSettingsPanel({ state }: { state: RotaAdminState }) {
  const { showToast } = useToast()
  const { isPending, pendingKey, run } = useActionWithRefresh()
  const settings = state.settings
  const [dpia, setDpia] = useState(settings?.dpiaReference ?? '')
  const [notice, setNotice] = useState(Boolean(settings?.privacyNoticeConfirmedAt))
  const [retention, setRetention] = useState(String(settings?.retentionDays ?? 30))
  const [horizon, setHorizon] = useState(String(settings?.horizonDays ?? 56))
  const [confirmation, setConfirmation] = useState('')

  function act(key: string, fn: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    run(async () => {
      const result = await fn()
      if (!result.ok) {
        showToast({ variant: 'error', title: 'Not saved', description: 'message' in result ? result.message : undefined })
        throw new Error('rota settings action failed')
      }
      showToast({ variant: 'success', title: success })
    }, key)
  }

  const governanceReady = Boolean(settings?.dpiaReference && settings?.privacyNoticeConfirmedAt)
  const cleanupOnly = state.cleanupOnly
  const departments = cleanupOnly ? state.departments.filter((d) => d.enrolled) : state.departments

  function toggleDepartment(d: RotaAdminState['departments'][number]) {
    if (
      d.enrolled &&
      !window.confirm(
        `Remove ${d.name} from rota availability? This deletes the department's rota suggestions now and removes its rota uploaders. Recorded moderator decisions stay in attendance.`
      )
    ) {
      return
    }
    act(`dept-${d.id}`, () => setRotaDepartmentEnrolment(d.id, !d.enrolled), d.enrolled ? 'Department removed' : 'Department enrolled')
  }

  return (
    <div className="space-y-6 font-mono text-sm">
      {cleanupOnly ? (
        <p className="border border-amber-700 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Rota availability is switched off on the server, but this organisation still holds rota data. You can delete
          it here: disable (deletes every rota suggestion and identity link), remove departments, or remove uploaders.
          Nothing else can be changed until it is switched back on.
        </p>
      ) : null}
      <p className="text-xs leading-5 text-gray-600">
        Status: <strong>{settings?.enabled ? 'enabled' : 'off'}</strong>. Rota data never decides attendance: every
        excusal is an individual moderator decision. Enable only once the trust&apos;s DPIA is signed and the staff privacy
        notice describes this use.
      </p>

      {cleanupOnly ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="DPIA reference" value={dpia} maxLength={120} onChange={(e) => setDpia(e.target.value)} />
            <div />
            <Input
              label="Delete rota suggestions this many days after finalization or the catch-up closing, whichever is later (1–90; never later than 90 days after the session)"
              type="number"
              min={1}
              max={90}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
            <Input
              label="Upload horizon in days (7–84)"
              type="number"
              min={7}
              max={84}
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={notice} onChange={(e) => setNotice(e.target.checked)} />
            <span>The staff privacy notice tells trainees that a rota summary is used to suggest excusals.</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              pending={isPending && pendingKey === 'governance'}
              disabled={isPending}
              onClick={() =>
                act(
                  'governance',
                  () =>
                    saveRotaGovernance({
                      dpiaReference: dpia,
                      privacyNoticeConfirmed: notice,
                      retentionDays: Number(retention),
                      horizonDays: Number(horizon),
                    }),
                  'Governance saved'
                )
              }
            >
              Save governance
            </Button>
            {!settings?.enabled ? (
              <Button
                pending={isPending && pendingKey === 'enable'}
                disabled={isPending || !governanceReady}
                onClick={() => act('enable', () => enableRota(), 'Rota availability enabled')}
              >
                Enable
              </Button>
            ) : null}
          </div>
          {!governanceReady && !settings?.enabled ? (
            <p className="text-xs text-gray-600">
              Enter the DPIA reference and confirm the privacy notice, then Save governance to enable.
            </p>
          ) : null}
        </>
      )}

      <div className="border-t border-black pt-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Departments</h3>
        {departments.length === 0 ? (
          <p className="text-gray-600">{cleanupOnly ? 'No enrolled departments.' : 'No departments yet.'}</p>
        ) : (
          <ul className="space-y-2">
            {departments.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 break-words">
                  {d.name} {d.enrolled ? <span className="text-xs text-gray-500">(enrolled)</span> : null}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  pending={isPending && pendingKey === `dept-${d.id}`}
                  disabled={isPending}
                  aria-label={d.enrolled ? `Remove ${d.name} from rota availability` : `Enrol ${d.name} in rota availability`}
                  onClick={() => toggleDepartment(d)}
                >
                  {d.enrolled ? 'Remove' : 'Enrol'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {settings?.enabled ? (
        <div className="border-t border-black pt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-red-700">Disable</h3>
          <p className="mb-3 text-xs leading-5 text-gray-600">
            Disabling deletes every rota flag and identity link for this organisation now. Upload profiles, uploader
            grants and the upload audit (counts only) are kept. Moderator decisions already recorded stay in attendance.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Input label="Type DISABLE" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            </div>
            <Button
              variant="danger"
              pending={isPending && pendingKey === 'disable'}
              disabled={isPending || confirmation !== 'DISABLE'}
              onClick={() => act('disable', () => disableRota(confirmation), 'Rota availability disabled')}
            >
              Disable and delete rota data
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
