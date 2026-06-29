'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Input } from './Input'
import { Select } from './Select'
import { useToast } from './ToastProvider'
import { updateDepartmentFeedbackFields } from '@/app/actions/feedback'
import { cloneDefaultFeedbackFormFields } from '@/lib/feedback-form'
import type { DepartmentFeedbackField, FeedbackFieldType } from '@/lib/types'

interface FeedbackTemplatePanelProps {
  departmentId: string
  initialFields: DepartmentFeedbackField[]
}

function buildNewField(type: FeedbackFieldType): DepartmentFeedbackField {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10)

  if (type === 'rating') {
    return {
      id: `custom_rating_${suffix}`,
      type,
      label: 'New scored question',
      required: true,
      commentLabel: 'Any further comments?',
    }
  }

  return {
    id: `custom_${type}_${suffix}`,
    type,
    label: type === 'textarea' ? 'New long-answer field' : 'New short-answer field',
    required: false,
    placeholder: type === 'textarea' ? 'Add response...' : 'Add response',
  }
}

function getTypeLabel(type: FeedbackFieldType) {
  if (type === 'rating') return 'Scored question'
  if (type === 'textarea') return 'Long answer'
  return 'Short answer'
}

function FieldPreview({ field }: { field: DepartmentFeedbackField }) {
  if (field.type === 'rating') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className="flex h-7 w-7 items-center justify-center border border-gray-300 font-mono text-xs text-gray-500"
          >
            {n}
          </span>
        ))}
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div className="h-14 w-full border border-dashed border-gray-300 bg-gray-50" />
    )
  }

  return (
    <div className="h-8 w-full max-w-xs border border-dashed border-gray-300 bg-gray-50" />
  )
}

export function FeedbackTemplatePanel({
  departmentId,
  initialFields,
}: FeedbackTemplatePanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [fields, setFields] = useState<DepartmentFeedbackField[]>(initialFields)
  const [loading, setLoading] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(
    () => initialFields[0]?.id ?? null
  )

  // Keep activeId in sync if the current active field is removed
  useEffect(() => {
    if (activeId && !fields.some((field) => field.id === activeId)) {
      setActiveId(fields[0]?.id ?? null)
    }
  }, [fields, activeId])

  function updateField(index: number, patch: Partial<DepartmentFeedbackField>) {
    setFields((currentFields) =>
      currentFields.map((field, fieldIndex) => {
        if (fieldIndex !== index) {
          return field
        }

        const nextField = {
          ...field,
          ...patch,
        }

        if (nextField.type === 'rating') {
          return {
            ...nextField,
            commentLabel: nextField.commentLabel || 'Any further comments?',
            placeholder: null,
          }
        }

        return {
          ...nextField,
          commentLabel: null,
          placeholder:
            nextField.placeholder ||
            (nextField.type === 'textarea' ? 'Add response...' : 'Add response'),
        }
      })
    )
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((currentFields) => {
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= currentFields.length) {
        return currentFields
      }

      const nextFields = [...currentFields]
      const [selectedField] = nextFields.splice(index, 1)
      nextFields.splice(targetIndex, 0, selectedField)
      return nextFields
    })
  }

  function removeField(index: number) {
    setFields((currentFields) => currentFields.filter((_, i) => i !== index))
  }

  function addField(type: FeedbackFieldType) {
    const newField = buildNewField(type)
    setFields((currentFields) => [...currentFields, newField])
    setActiveId(newField.id)
  }

  async function handleSave() {
    setLoading(true)

    try {
      await updateDepartmentFeedbackFields(departmentId, fields)
      showToast({
        variant: 'success',
        title: 'Feedback form updated',
        description: 'The public feedback form now uses the revised field set.',
      })
      router.refresh()
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Save failed',
        description:
          error instanceof Error ? error.message : 'Failed to save feedback settings',
      })
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    const defaults = cloneDefaultFeedbackFormFields()
    setFields(defaults)
    setActiveId(defaults[0]?.id ?? null)
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-mono font-bold text-sm">Feedback Form</h3>
        <p className="mt-2 font-mono text-xs text-gray-500">
          Tap a field to edit it. Start from the RCPCH-style teaching prompts below,
          then add or edit fields for this department. Scored questions use the
          standard 1 to 5 teaching scale.
        </p>
      </div>

      <div className="space-y-3">
        {fields.map((field, index) => {
          const isActive = field.id === activeId
          const isFirst = index === 0
          const isLast = index === fields.length - 1

          if (!isActive) {
            return (
              <button
                key={field.id}
                type="button"
                onClick={() => setActiveId(field.id)}
                className="block w-full border-2 border-gray-300 bg-white p-4 text-left hover:border-black focus:border-black focus:outline-none"
              >
                <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-gray-400">
                  Field {index + 1} · {getTypeLabel(field.type)}
                </p>
                <p className="mt-2 font-mono text-sm font-bold break-words">
                  {field.label || (
                    <span className="text-gray-400">Untitled field</span>
                  )}
                  {field.required ? (
                    <span className="ml-1 text-gray-500">*</span>
                  ) : null}
                </p>
                <div className="mt-3">
                  <FieldPreview field={field} />
                </div>
              </button>
            )
          }

          return (
            <div
              key={field.id}
              className="w-full border-2 border-black bg-gray-50"
            >
              <div className="space-y-4 p-4">
                <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-gray-500">
                  Field {index + 1} · Editing
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
                  <Input
                    label="Question"
                    type="text"
                    value={field.label}
                    onChange={(event) =>
                      updateField(index, { label: event.target.value })
                    }
                    placeholder="Enter the question attendees should answer"
                  />
                  <Select
                    label="Type"
                    value={field.type}
                    onChange={(event) =>
                      updateField(index, {
                        type: event.target.value as FeedbackFieldType,
                      })
                    }
                  >
                    <option value="rating">Scored question</option>
                    <option value="textarea">Long answer</option>
                    <option value="text">Short answer</option>
                  </Select>
                </div>

                {field.type === 'rating' ? (
                  <Input
                    label="Follow-up comment prompt"
                    type="text"
                    value={field.commentLabel || ''}
                    onChange={(event) =>
                      updateField(index, { commentLabel: event.target.value })
                    }
                    placeholder="Optional follow-up prompt shown under the score"
                  />
                ) : (
                  <Input
                    label="Placeholder"
                    type="text"
                    value={field.placeholder || ''}
                    onChange={(event) =>
                      updateField(index, { placeholder: event.target.value })
                    }
                    placeholder="Placeholder text for the public form"
                  />
                )}

                <div className="border-t border-gray-300" />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Move field up"
                      onClick={() => moveField(index, -1)}
                      disabled={isFirst || loading}
                      className="flex h-9 w-9 items-center justify-center border border-black bg-white font-mono text-base leading-none hover:bg-gray-100 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move field down"
                      onClick={() => moveField(index, 1)}
                      disabled={isLast || loading}
                      className="flex h-9 w-9 items-center justify-center border border-black bg-white font-mono text-base leading-none hover:bg-gray-100 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="Remove field"
                      onClick={() => removeField(index)}
                      disabled={loading}
                      className="h-9 border border-black bg-white px-3 font-mono text-xs uppercase tracking-[0.14em] hover:bg-red-50 disabled:opacity-30"
                    >
                      Remove
                    </button>
                  </div>

                  <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        updateField(index, { required: event.target.checked })
                      }
                      className="h-4 w-4 border border-black accent-black"
                    />
                    Required
                  </label>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border border-black p-4">
        <p className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-gray-500">
          Add Field
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => addField('rating')}
            disabled={loading}
            className="w-full"
          >
            + Scored
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => addField('textarea')}
            disabled={loading}
            className="w-full"
          >
            + Long Answer
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => addField('text')}
            disabled={loading}
            className="w-full"
          >
            + Short Answer
          </Button>
        </div>
        <div className="mt-4 border-t border-gray-300 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={handleReset}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            Reset to RCPCH Template
          </Button>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          {loading ? 'Saving...' : 'Save Feedback Form'}
        </Button>
      </div>
    </div>
  )
}
