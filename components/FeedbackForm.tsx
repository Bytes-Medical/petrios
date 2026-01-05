'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Textarea } from './Textarea'
import { submitFeedback } from '@/app/actions/feedback'

interface FeedbackFormProps {
  sessionId: string
  sessionTitle: string
}

export function FeedbackForm({ sessionId, sessionTitle }: FeedbackFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [isAnonymous, setIsAnonymous] = useState(true)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    
    if (!rating) {
      setError('Please select a rating')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      await submitFeedback(sessionId, {
        rating,
        comment: comment.trim() || undefined,
        isAnonymous,
      })
      setSuccess(true)
      setRating(null)
      setComment('')
      setTimeout(() => {
        setSuccess(false)
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 border border-green-500 bg-green-50">
          <p className="font-mono text-sm text-green-800">
            Thank you for your feedback! Your response has been recorded.
          </p>
        </div>
      )}

      <div>
        <label className="block text-sm font-mono font-bold mb-3">
          How would you rate this session? *
        </label>
        <div className="flex gap-2 sm:gap-4">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              className={`w-12 h-12 sm:w-16 sm:h-16 border-2 font-mono text-lg sm:text-xl font-bold transition-colors ${
                rating === value
                  ? 'border-black bg-black text-white'
                  : 'border-gray-400 bg-white text-black hover:border-gray-600'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-2 font-mono text-xs text-gray-600">
          <span>Poor</span>
          <span>Excellent</span>
        </div>
      </div>

      <Textarea
        label="Comments (optional)"
        name="comment"
        rows={6}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Share your thoughts about this session..."
      />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="anonymous"
          checked={isAnonymous}
          onChange={(e) => setIsAnonymous(e.target.checked)}
          className="w-4 h-4 border border-black"
        />
        <label htmlFor="anonymous" className="font-mono text-sm">
          Submit anonymously (recommended)
        </label>
      </div>

      <div className="flex gap-4">
        <Button type="submit" disabled={loading || !rating} className="w-full sm:w-auto">
          {loading ? 'Submitting...' : 'Submit Feedback'}
        </Button>
      </div>
    </form>
  )
}
