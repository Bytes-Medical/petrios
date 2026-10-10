'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Select } from '@/components/Select'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import { previewRotaMatches, saveRotaUploadProfile, submitRotaUpload } from '@/app/actions/rota-upload'
import { buildRotaBatches, type RotaPayloadPersonInput } from '@/lib/rota/build-payload'
import { canonicalRotaJson, sha256Hex } from '@/lib/rota/canonical'
import { CSV_DEFAULT_MAX_BYTES, parseCsv, RotaCsvError } from '@/lib/rota/csv'
import { buildDayTemplates, RotaTemplateOverflowError, RotaTemplateRegistry, unmappedCodes } from '@/lib/rota/dictionary'
import { extractRotaRows } from '@/lib/rota/mapping'
import { defaultRotaProfileConfig, rotaProfileConfigSchema, type RotaProfileConfig } from '@/lib/rota/profile'
import { addDaysToKey, ROTA_LIMITS } from '@/lib/rota/schema'
import type { RotaBatchPayload, RotaMatchPreview, RotaPersonLink, RotaUploadContext, RotaUploadSummary as Summary } from '@/lib/rota/types'
import { RotaCodeDictionary } from './RotaCodeDictionary'
import { RotaColumnMapper } from './RotaColumnMapper'
import { RotaMatchReview, type RotaConfirmations } from './RotaMatchReview'
import { RotaUploadSummary } from './RotaUploadSummary'

/**
 * The rota upload (spec/14, DESIGN §5.2). Everything up to "Upload" happens
 * in this browser: the CSV is parsed here, codes become status letters here,
 * names are compared here. The match check sends the staff number and/or
 * email of every row once (checked against the department's trainees, never
 * stored). The upload then sends, per matched row, an opaque row ref, the
 * staff number and/or email (to compute a keyed hash, then discarded) and one
 * status letter per day, split into an as-worked batch (days before today)
 * and a planned batch (today onwards). A coordinator's rows carry the match
 * check's row proofs, so only checked rows can be uploaded.
 */

const STEPS = ['File', 'Columns', 'Codes', 'Post-night rest', 'Identity', 'Upload'] as const

/** 2026-09-26 → 26/09/2026 (the format NHS staff use). */
function ukDate(key: string): string {
  const [y, m, d] = key.split('-')
  return `${d}/${m}/${y}`
}

function weeksLabel(days: number): string {
  const weeks = Math.round(days / 7)
  return weeks === 1 ? 'one week' : `${weeks} weeks`
}

function newIds() {
  return { upload: crypto.randomUUID(), worked: crypto.randomUUID(), planned: crypto.randomUUID() }
}

function configIssues(result: ReturnType<typeof rotaProfileConfigSchema.safeParse>, section?: 'columns'): string[] {
  if (result.success) return []
  const issues = section ? result.error.issues.filter((issue) => issue.path[0] === section) : result.error.issues
  return [...new Set(issues.map((issue) => issue.message))]
}

export function RotaUploadWizard({ departmentId, context }: { departmentId: string; context: RotaUploadContext }) {
  const [ids] = useState(newIds)
  const [step, setStep] = useState(0)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<{ header: string[]; rows: string[][] } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [config, setConfig] = useState<RotaProfileConfig>(() => defaultRotaProfileConfig('WIDE'))
  const [preview, setPreview] = useState<RotaMatchPreview | null>(null)
  const [checking, setChecking] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [confirmations, setConfirmations] = useState<RotaConfirmations>({})
  const [saveProfile, setSaveProfile] = useState(true)
  const [profileName, setProfileName] = useState('Weekly rota export')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [results, setResults] = useState<{ kind: 'WORKED' | 'PLANNED'; summary: Summary }[] | null>(null)
  const { isPending, run } = useActionWithRefresh()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const stepChanged = useRef(false)

  // Move focus to the new step's heading so screen readers announce it
  // (never on first render, which would steal focus on page load).
  useEffect(() => {
    if (!stepChanged.current) {
      stepChanged.current = true
      return
    }
    headingRef.current?.focus()
  }, [step])

  const savedProfiles = useMemo(
    () =>
      context.profiles.flatMap((p) => {
        const check = rotaProfileConfigSchema.safeParse(p.config)
        return check.success ? [{ id: p.id, name: p.name, config: check.data }] : []
      }),
    [context.profiles]
  )

  const uploadWindow = useMemo(
    () => ({ from: addDaysToKey(context.todayKey, -14), to: addDaysToKey(context.todayKey, context.horizonDays) }),
    [context.todayKey, context.horizonDays]
  )
  const configCheck = useMemo(() => rotaProfileConfigSchema.safeParse(config), [config])
  // Reading the file depends only on the layout, columns, date format and id
  // rule, never on the code legend. Validating those parts on their own keeps
  // the people (and the code dictionary) on screen while a code entry is
  // half-filled, e.g. a start time typed before its end time.
  const layoutKey = JSON.stringify([config.layout, config.columns, config.dateFormat, config.idNormalisation])
  const layoutCheck = useMemo(() => {
    const [layout, columns, dateFormat, idNormalisation] = JSON.parse(layoutKey) as [
      RotaProfileConfig['layout'],
      RotaProfileConfig['columns'],
      RotaProfileConfig['dateFormat'],
      RotaProfileConfig['idNormalisation'],
    ]
    return rotaProfileConfigSchema.safeParse({ ...defaultRotaProfileConfig(layout), columns, dateFormat, idNormalisation })
  }, [layoutKey])
  const extraction = useMemo(() => {
    if (!parsed || !layoutCheck.success) return null
    return extractRotaRows(parsed, layoutCheck.data, uploadWindow)
  }, [parsed, layoutCheck, uploadWindow])
  const unmapped = useMemo(() => (extraction ? unmappedCodes(extraction.distinctCodes, config) : []), [extraction, config])
  const datesProblem = !extraction
    ? null
    : extraction.dates.recognised === 0
      ? config.layout === 'WIDE'
        ? 'No column headers read as dates. Check the date format (the header needs the year, for example 05/10/2026).'
        : 'No dates in the date column could be read. Check the date format.'
      : extraction.dates.inWindow === 0
        ? `No dates fall inside the upload window (${ukDate(uploadWindow.from)} to ${ukDate(uploadWindow.to)}). Export the rota from two weeks back to ${weeksLabel(context.horizonDays)} ahead.`
        : null

  const range = useMemo(() => {
    if (!extraction) return null
    let from: string | null = null
    let to: string | null = null
    for (const person of extraction.people) {
      for (const day of Object.keys(person.dayCodes)) {
        if (!from || day < from) from = day
        if (!to || day > to) to = day
      }
    }
    return from && to ? { from, to } : null
  }, [extraction])

  const sendable = useMemo<RotaPayloadPersonInput[]>(() => {
    if (!extraction || !preview) return []
    const out: RotaPayloadPersonInput[] = []
    if (preview.role === 'UPLOADER') {
      const matched = new Set(preview.rows.filter((r) => r.matched && r.proof).map((r) => r.ref))
      for (const p of extraction.people) {
        if (matched.has(p.ref) && (p.staffKey || p.email)) out.push({ ref: p.ref, staffKey: p.staffKey, email: p.email, days: '' })
      }
      return out
    }
    const matched = new Set(preview.rows.filter((r) => r.userId).map((r) => r.ref))
    for (const p of extraction.people) {
      const link = confirmations[p.ref]
      if (link) out.push({ ref: p.ref, staffKey: p.staffKey, email: p.email, link, days: '' })
      else if (matched.has(p.ref)) out.push({ ref: p.ref, staffKey: p.staffKey, email: p.email, days: '' })
    }
    return out.slice(0, ROTA_LIMITS.maxPeople)
  }, [extraction, preview, confirmations])

  const built = useMemo<
    { ok: true; worked: RotaBatchPayload | null; planned: RotaBatchPayload | null } | { ok: false; message: string } | null
  >(() => {
    if (!extraction || !range || !configCheck.success || sendable.length === 0) return null
    const byRef = new Map(extraction.people.map((p) => [p.ref, p]))
    try {
      const registry = new RotaTemplateRegistry()
      const people = sendable.map((s) => ({
        ...s,
        days: buildDayTemplates(byRef.get(s.ref)!, configCheck.data, range, registry).days,
      }))
      return {
        ok: true,
        ...buildRotaBatches({
          people,
          templates: registry.templates,
          range,
          todayKey: context.todayKey,
          batchIds: { worked: ids.worked, planned: ids.planned },
        }),
      }
    } catch (error) {
      if (error instanceof RotaTemplateOverflowError) {
        return { ok: false, message: 'This rota has more than 62 different day patterns. Simplify the code times or split the file.' }
      }
      return { ok: false, message: 'The upload could not be prepared.' }
    }
  }, [extraction, range, configCheck, sendable, context.todayKey, ids])

  async function onFile(file: File | undefined) {
    setFileError(null)
    setParsed(null)
    setFileName(null)
    if (!file) return
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setFileError('Choose a CSV file. Export the rota as CSV first.')
      return
    }
    if (file.size > CSV_DEFAULT_MAX_BYTES) {
      setFileError('The file is larger than 10 MB.')
      return
    }
    try {
      const text = await file.text()
      setParsed(parseCsv(text))
      setFileName(file.name)
    } catch (error) {
      setFileError(error instanceof RotaCsvError ? `The file could not be read: ${error.message}.` : 'The file could not be read.')
    }
  }

  function chooseProfile(value: string) {
    if (value === 'new-wide' || value === 'new-long') {
      setProfileId(null)
      setConfig(defaultRotaProfileConfig(value === 'new-wide' ? 'WIDE' : 'LONG'))
      return
    }
    const saved = savedProfiles.find((p) => p.id === value)
    if (saved) {
      setProfileId(saved.id)
      setConfig(saved.config)
      setProfileName(saved.name)
    }
  }

  async function checkMatches() {
    if (!extraction) return
    setChecking(true)
    setPreviewError(null)
    try {
      const result = await previewRotaMatches({
        departmentId,
        uploadId: ids.upload,
        people: extraction.people
          .filter((p) => p.staffKey || p.email)
          .slice(0, 500)
          .map((p) => ({ ref: p.ref, ...(p.staffKey ? { staffKey: p.staffKey } : {}), ...(p.email ? { email: p.email } : {}) })),
      })
      if (result.ok) setPreview(result.data)
      else setPreviewError(result.message)
    } catch {
      setPreviewError('The match check failed. Reload the page and try again.')
    } finally {
      setChecking(false)
    }
  }

  function confirm(ref: string, link: RotaPersonLink | null) {
    setConfirmations((current) => {
      const next = { ...current }
      if (link) next[ref] = link
      else delete next[ref]
      return next
    })
  }

  function upload() {
    if (!built || !built.ok) return
    run(async () => {
      setSubmitError(null)
      let usedProfileId = profileId
      if (saveProfile && configCheck.success) {
        const saved = await saveRotaUploadProfile({
          departmentId,
          profileId: profileId ?? undefined,
          name: profileName,
          config: configCheck.data,
        })
        if (!saved.ok) {
          setSubmitError(saved.message)
          return
        }
        usedProfileId = saved.data.profileId
        setProfileId(saved.data.profileId)
      }
      const out: { kind: 'WORKED' | 'PLANNED'; summary: Summary }[] = []
      // Rows dropped here as unmatched are counted (never sent) so the stored
      // batch audit can report "new unmatched since the last upload".
      const notSentCount = Math.max(0, (extraction?.people.length ?? 0) - sendable.length)
      // A coordinator's rows each carry the match check's proof for that row.
      const proofs =
        preview?.role === 'UPLOADER'
          ? Object.fromEntries(preview.rows.flatMap((r) => (r.proof ? [[r.ref, r.proof] as const] : [])))
          : undefined
      for (const batch of [built.worked, built.planned]) {
        if (!batch) continue
        const payloadSha256 = await sha256Hex(canonicalRotaJson(batch))
        const batchProofs = proofs
          ? Object.fromEntries(batch.people.flatMap((p) => (proofs[p.ref] ? [[p.ref, proofs[p.ref]] as const] : [])))
          : undefined
        const result = await submitRotaUpload({
          departmentId,
          uploadId: ids.upload,
          profileId: usedProfileId,
          payloadSha256,
          batch,
          proofs: batchProofs,
          notSentCount,
        })
        if (!result.ok) {
          setSubmitError(result.message)
          if (out.length > 0) setResults(out)
          return
        }
        out.push({ kind: batch.kind, summary: result.data })
      }
      setResults(out)
    }, 'upload')
  }

  if (results && !submitError) {
    const dropped = (extraction?.people.length ?? 0) - sendable.length
    return (
      <div className="space-y-4">
        <h3 className="font-mono text-lg font-bold">Upload complete</h3>
        <RotaUploadSummary results={results} droppedInBrowser={dropped} />
        <Button variant="secondary" onClick={() => globalThis.location.reload()}>
          Start a new upload
        </Button>
      </div>
    )
  }

  const locked = preview !== null
  const canNext = [
    parsed !== null,
    configCheck.success && (extraction?.people.length ?? 0) > 0 && datesProblem === null,
    configCheck.success && unmapped.length === 0,
    configCheck.success,
    preview !== null,
    false,
  ][step]

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 font-mono text-xs" aria-label="Upload steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`border px-2 py-1 ${index === step ? 'border-clay-600 bg-clay-600 text-white' : index < step ? 'border-black bg-white' : 'border-gray-300 text-gray-500'}`}
            aria-current={index === step ? 'step' : undefined}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <h3 ref={headingRef} tabIndex={-1} className="font-mono text-base font-bold focus:outline-none">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </h3>

      {step === 0 ? (
        <div className="space-y-4">
          <p className="font-mono text-sm leading-6 text-gray-700">
            Export the rota as CSV covering two weeks back to {weeksLabel(context.horizonDays)} ahead, for this
            department&apos;s doctors in training only. The file is read on this device and is never uploaded. The staff
            number or email of every row is checked once against this department&apos;s trainees and is not stored.
            Petrios then receives one status per day for rows that match trainees; never shift codes, leave reasons or
            names.
          </p>
          <Select
            label="Profile"
            value={profileId ?? (config.layout === 'LONG' ? 'new-long' : 'new-wide')}
            onChange={(e) => chooseProfile(e.target.value)}
            disabled={locked}
          >
            {savedProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="new-wide">New profile: grid layout</option>
            <option value="new-long">New profile: list layout</option>
          </Select>
          <label className="block font-mono text-sm">
            <span className="mb-1 block">Rota file (CSV, up to 10 MB)</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={locked}
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="block w-full border border-black bg-white p-2 font-mono text-sm"
            />
          </label>
          {fileName && parsed ? (
            <p className="font-mono text-xs text-gray-600">
              {fileName}: {parsed.rows.length} rows, {parsed.header.length} columns.
            </p>
          ) : null}
          {fileError ? (
            <p role="alert" className="font-mono text-sm text-red-700">
              {fileError}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 1 && parsed ? (
        <div className="space-y-4">
          <RotaColumnMapper header={parsed.header} previewRows={parsed.rows.slice(0, 5)} config={config} onChange={setConfig} />
          <div role="alert" className="space-y-1">
            {configIssues(configCheck, 'columns').map((message) => (
              <p key={message} className="font-mono text-sm text-red-700">
                {message}
              </p>
            ))}
            {datesProblem ? <p className="font-mono text-sm text-red-700">{datesProblem}</p> : null}
          </div>
          {extraction && !datesProblem ? (
            <p className="font-mono text-xs text-gray-600">
              {extraction.dates.inWindow} date{extraction.dates.inWindow === 1 ? '' : 's'} recognised in the upload window
              {extraction.dates.first && extraction.dates.last
                ? ` (${ukDate(extraction.dates.first)} to ${ukDate(extraction.dates.last)})`
                : ''}
              . {extraction.people.length} {extraction.people.length === 1 ? 'person has' : 'people have'} shift codes on
              those dates
              {extraction.skippedNoDays > 0 ? `; ${extraction.skippedNoDays} without any are left out` : ''}.
            </p>
          ) : null}
          {extraction && extraction.issues.length > 0 ? (
            <details className="border border-black p-3 font-mono text-xs">
              <summary className="cursor-pointer">{extraction.issues.length} cell(s) could not be read</summary>
              <ul className="mt-2 list-disc pl-5">
                {extraction.issues.slice(0, 50).map((issue, index) => (
                  <li key={index}>
                    Line {issue.line}, {issue.field}: {issue.problem}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {step === 2 && extraction ? (
        <div className="space-y-4">
          <RotaCodeDictionary distinctCodes={extraction.distinctCodes} config={config} onChange={setConfig} />
          {unmapped.length > 0 ? (
            <p className="font-mono text-sm text-amber-800" aria-live="polite">
              Map {unmapped.length} more code{unmapped.length === 1 ? '' : 's'} to continue.
            </p>
          ) : null}
          <div role="alert" className="space-y-1">
            {configIssues(configCheck).map((message) => (
              <p key={message} className="font-mono text-sm text-red-700">
                {message}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4 font-mono text-sm">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={config.postNight.enabled}
              onChange={(e) => setConfig({ ...config, postNight: { ...config.postNight, enabled: e.target.checked } })}
            />
            <span>Mark 46 hours of post-night rest after the last night of a run</span>
          </label>
          <Select
            label="Apply rest after"
            value={config.postNight.trigger}
            disabled={!config.postNight.enabled}
            onChange={(e) =>
              setConfig({ ...config, postNight: { ...config.postNight, trigger: e.target.value as 'ANY' | 'THREE_OR_MORE' } })
            }
          >
            <option value="ANY">Any run of nights (default)</option>
            <option value="THREE_OR_MORE">Runs of three or more nights only</option>
          </Select>
          <p className="text-xs leading-5 text-gray-600">
            A night is a code ticked <strong>Night</strong> in the code step (mapped to nights or to on duty elsewhere,
            with times), or a nights code whose times cross midnight. Rest is counted in local clock hours from the end
            of the last night (a night ending 09:30 rests until 07:30 two days later). Across a clock change this can be
            an hour out. A code entered in the rota always wins for the hours it covers; inferred rest fills the rest of
            that day. Agree these rules with your DME and Guardian of Safe Working Hours.
          </p>
        </div>
      ) : null}

      {step === 4 && extraction ? (
        <div className="space-y-3">
          <RotaMatchReview
            role={context.callerRole}
            people={extraction.people}
            preview={preview}
            roster={context.roster}
            confirmations={confirmations}
            onConfirm={confirm}
            onCheck={() => void checkMatches()}
            checking={checking}
          />
          {extraction.people.length > 500 ? (
            <p role="alert" className="font-mono text-sm text-amber-800">
              This file has {extraction.people.length} people; only the first 500 can be checked and sent. Export one
              department&apos;s rota at a time.
            </p>
          ) : null}
          {previewError ? (
            <p role="alert" className="font-mono text-sm text-red-700">
              {previewError}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 5 ? (
        <div className="space-y-4 font-mono text-sm">
          <p>
            <strong>{sendable.length}</strong> row{sendable.length === 1 ? '' : 's'} will be sent;{' '}
            <strong>{(extraction?.people.length ?? 0) - sendable.length}</strong> rota row
            {(extraction?.people.length ?? 0) - sendable.length === 1 ? '' : 's'} not matched will not.
          </p>
          {range ? (
            <p className="text-xs text-gray-600">
              Days {ukDate(range.from)} to {ukDate(range.to)}: before {ukDate(context.todayKey)} as worked, from{' '}
              {ukDate(context.todayKey)} as planned.
            </p>
          ) : (
            <p role="alert" className="text-xs text-red-700">
              No days in the upload window have shift codes.
            </p>
          )}
          {built && !built.ok ? (
            <p role="alert" className="text-red-700">
              {built.message}
            </p>
          ) : null}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
            <span>{profileId ? 'Update the saved profile' : 'Save these settings as a profile for next time'}</span>
          </label>
          {saveProfile ? (
            <Input label="Profile name" value={profileName} maxLength={80} onChange={(e) => setProfileName(e.target.value)} />
          ) : null}
          {submitError ? (
            <p role="alert" className="text-red-700">
              {submitError}
            </p>
          ) : null}
          {results && submitError ? <RotaUploadSummary results={results} droppedInBrowser={0} /> : null}
          <Button onClick={upload} pending={isPending} disabled={!built || !built.ok}>
            Upload
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 border-t border-black pt-4">
        <Button
          variant="secondary"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || (locked && step <= 2) || isPending}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={!canNext}>
            Next
          </Button>
        ) : null}
        {locked && step <= 4 ? (
          <span className="self-center font-mono text-xs text-gray-500">
            The file and columns are fixed after the match check. Reload the page to start over.
          </span>
        ) : null}
      </div>
    </div>
  )
}
