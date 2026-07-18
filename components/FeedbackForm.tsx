'use client'

import { useMemo, useState } from 'react'
import { Button } from './Button'
import { Input } from './Input'
import { Select } from './Select'
import { Textarea } from './Textarea'
import { useToast } from './ToastProvider'
import { FEEDBACK_RATING_OPTIONS } from '@/lib/feedback-form'
import type { DepartmentFeedbackField, FeedbackAnswerInput } from '@/lib/types'
import { submitFeedback } from '@/app/actions/feedback'

interface FeedbackFormProps {
  sessionId: string
  sessionTitle: string
  feedbackFields: DepartmentFeedbackField[]
}

type AnswerState = Record<string, { value: string; comment: string }>

function buildInitialAnswerState(feedbackFields: DepartmentFeedbackField[]) {
  return feedbackFields.reduce<AnswerState>((state, field) => {
    state[field.id] = {
      value: '',
      comment: '',
    }
    return state
  }, {})
}

export function FeedbackForm({ sessionId, sessionTitle, feedbackFields }: FeedbackFormProps) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const initialAnswerState = useMemo(() => buildInitialAnswerState(feedbackFields), [feedbackFields])
  const [answers, setAnswers] = useState<AnswerState>(initialAnswerState)

  function updateAnswer(fieldId: string, patch: Partial<{ value: string; comment: string }>) {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [fieldId]: {
        ...currentAnswers[fieldId],
        ...patch,
      },
    }))
  }

  const hasMissingIdentity = !firstName.trim() || !lastName.trim() || !email.trim()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (hasMissingIdentity) {
      showToast({
        variant: 'error',
        title: 'Missing attendee details',
        description: 'Please fill in your first name, last name, and email address.',
      })
      return
    }

    const structuredAnswers: FeedbackAnswerInput[] = feedbackFields.map((field) => ({
      fieldId: field.id,
      value: answers[field.id]?.value?.trim() || undefined,
      comment: answers[field.id]?.comment?.trim() || undefined,
    }))

    setLoading(true)

    try {
      await submitFeedback(sessionId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        answers: structuredAnswers,
      })

      showToast({
        variant: 'success',
        title: 'Feedback submitted',
        description: `Your feedback for ${sessionTitle} has been recorded. Attendance is managed separately.`,
      })

      setFirstName('')
      setLastName('')
      setEmail('')
      setAnswers(buildInitialAnswerState(feedbackFields))
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Submission failed',
        description: error instanceof Error ? error.message : 'Failed to submit feedback',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-3 border border-black p-4">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-gray-500">
          Identified session feedback
        </p>
        <p className="font-mono text-sm text-gray-600">
          Fields marked with * are required.
        </p>
        <p className="font-mono text-xs text-gray-500 italic leading-6">
          Your name and email are stored with this response and visible to authorised moderators.
          Teacher release contains aggregate ratings only, omits identities and raw comments, and
          withholds detailed analytics when fewer than five people respond. Feedback does not mark
          attendance or issue a certificate.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="First Name *"
          type="text"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          placeholder="Enter your first name"
          required
        />
        <Input
          label="Last Name *"
          type="text"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          placeholder="Enter your last name"
          required
        />
      </div>

      <Input
        label="Email *"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Enter your email address"
        required
      />

      <div className="space-y-6">
        {feedbackFields.map((field) => (
          <div key={field.id} className="space-y-3 border-t border-black pt-6 first:border-t-0 first:pt-0">
            {field.type === 'rating' ? (
              <>
                <Select
                  label={`${field.label}${field.required ? ' *' : ''}`}
                  value={answers[field.id]?.value || ''}
                  onChange={(event) => updateAnswer(field.id, { value: event.target.value })}
                  required={field.required}
                >
                  <option value="">---</option>
                  {FEEDBACK_RATING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>

                {field.commentLabel ? (
                  <Textarea
                    label={field.commentLabel}
                    rows={5}
                    value={answers[field.id]?.comment || ''}
                    onChange={(event) => updateAnswer(field.id, { comment: event.target.value })}
                    placeholder="Add any supporting comments..."
                  />
                ) : null}
              </>
            ) : field.type === 'textarea' ? (
              <Textarea
                label={`${field.label}${field.required ? ' *' : ''}`}
                rows={6}
                value={answers[field.id]?.value || ''}
                onChange={(event) => updateAnswer(field.id, { value: event.target.value })}
                placeholder={field.placeholder || 'Add your response...'}
                required={field.required}
              />
            ) : (
              <Input
                label={`${field.label}${field.required ? ' *' : ''}`}
                type="text"
                value={answers[field.id]?.value || ''}
                onChange={(event) => updateAnswer(field.id, { value: event.target.value })}
                placeholder={field.placeholder || 'Add your response'}
                required={field.required}
              />
            )}
          </div>
        ))}
      </div>

      <Button type="submit" disabled={loading || hasMissingIdentity} className="w-full sm:w-auto">
        {loading ? 'Submitting...' : 'Submit Feedback'}
      </Button>
    </form>
  )
}
