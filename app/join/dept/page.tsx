'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Input } from '@/components/Input'
import { Select } from '@/components/Select'
import { Button } from '@/components/Button'
import { lookupDepartmentByCode, beginDepartmentOnboarding } from '@/app/actions/member-onboarding'
import { TRAINEE_GRADES } from '@/lib/types'

export default function JoinByDeptCodePage() {
  const [step, setStep] = useState<'code' | 'details' | 'done'>('code')
  const [deptCode, setDeptCode] = useState('')
  const [deptName, setDeptName] = useState('')
  const [orgName, setOrgName] = useState('')

  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [grade, setGrade] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const dept = await lookupDepartmentByCode(deptCode)
      if (!dept) {
        setError('No department found with that code. Please check and try again.')
        return
      }
      setDeptName(dept.department_name)
      setOrgName(dept.org_name)
      setStep('details')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to look up department')
    } finally {
      setLoading(false)
    }
  }

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const result = await beginDepartmentOnboarding({
        departmentCode: deptCode,
        email,
        firstName,
        lastName,
        grade: grade || undefined,
      })

      if (result.status === 'joined') {
        window.location.replace(result.redirectTo)
        return
      }

      if (result.status === 'email-sent') {
        setSuccess(result.message)
        setStep('done')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join department')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Image
            src="/assets/byte_logo.png"
            alt="Byte Teaching Logo"
            width={200}
            height={133}
            className="w-auto h-auto max-w-full"
            priority
          />
        </div>

        <h1 className="text-xl font-mono font-bold text-center mb-2">Join a Department</h1>
        <p className="text-center font-mono text-sm text-gray-600 mb-6">
          Enter the 6-digit department code given to you by your programme.
        </p>

        {error && (
          <div className="border border-red-500 bg-red-50 p-4 mb-4">
            <p className="font-mono text-sm text-red-800">{error}</p>
          </div>
        )}

        {step === 'code' && (
          <form onSubmit={handleCodeSubmit} className="space-y-4 border border-black bg-white p-6">
            <Input
              label="Department Code"
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="e.g. 482913"
              maxLength={6}
              pattern="\d{6}"
              required
              className="text-center text-2xl tracking-[0.3em] font-mono"
            />
            <Button type="submit" disabled={loading || deptCode.length !== 6} className="w-full">
              {loading ? 'Looking up...' : 'Find Department'}
            </Button>
          </form>
        )}

        {step === 'details' && (
          <>
            <div className="border border-black bg-white p-4 mb-4">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-gray-500">Department</p>
              <h2 className="mt-1 font-mono text-xl font-bold">{deptName}</h2>
              <p className="mt-1 font-mono text-sm text-gray-600">{orgName}</p>
              <button
                type="button"
                onClick={() => { setStep('code'); setError(null) }}
                className="mt-2 font-mono text-xs underline text-gray-500"
              >
                Change code
              </button>
            </div>

            <form onSubmit={handleDetailsSubmit} className="space-y-4 border border-black bg-white p-6">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
                <Input
                  label="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
              <Select
                label="Grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                required
              >
                <option value="">Select your grade</option>
                {TRAINEE_GRADES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </Select>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Joining...' : 'Join Department'}
              </Button>
            </form>
          </>
        )}

        {step === 'done' && success && (
          <div className="border border-black bg-white p-6">
            <h3 className="font-mono text-lg font-bold">Check Your Email</h3>
            <p className="mt-3 font-mono text-sm text-gray-600">{success}</p>
            <p className="mt-3 font-mono text-sm text-gray-600">
              After opening the link, you will finish joining the department and land on your dashboard.
            </p>
          </div>
        )}

        <div className="mt-6 text-center">
          <Link href="/trainee-login" className="font-mono text-sm underline">
            Already have access? Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
