'use client'

import { useState, useEffect } from 'react'
import { Card } from './Card'

interface FeedbackAnalysisPanelProps {
  sessionId: string
}

interface FeedbackStats {
  total: number
  averageRating: number
  ratingDistribution: { [key: number]: number }
  commentsCount: number
  comments: any[]
}

export function FeedbackAnalysisPanel({ sessionId }: FeedbackAnalysisPanelProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<FeedbackStats | null>(null)

  useEffect(() => {
    async function loadStats() {
      try {
        setLoading(true)
        const response = await fetch(`/api/sessions/${sessionId}/feedback/stats`)
        if (!response.ok) {
          throw new Error('Failed to load feedback')
        }
        const data = await response.json()
        setStats(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feedback')
      } finally {
        setLoading(false)
      }
    }
    loadStats()
  }, [sessionId])

  if (loading) {
    return <p className="font-mono text-sm">Loading feedback...</p>
  }

  if (error) {
    return (
      <div className="p-4 border border-red-500 bg-red-50">
        <p className="font-mono text-sm text-red-800">{error}</p>
      </div>
    )
  }

  if (!stats || stats.total === 0) {
    return (
      <div>
        <p className="font-mono text-sm text-gray-600 mb-4">No feedback received yet.</p>
        <p className="font-mono text-sm">Share the feedback link or QR code with attendees to collect feedback.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="font-mono text-sm text-gray-600 mb-1">Total Responses</p>
          <p className="text-3xl font-mono font-bold">{stats.total}</p>
        </Card>
        <Card>
          <p className="font-mono text-sm text-gray-600 mb-1">Average Rating</p>
          <p className="text-3xl font-mono font-bold">{stats.averageRating.toFixed(1)}</p>
          <p className="font-mono text-xs text-gray-600 mt-1">out of 5.0</p>
        </Card>
        <Card>
          <p className="font-mono text-sm text-gray-600 mb-1">Comments</p>
          <p className="text-3xl font-mono font-bold">{stats.commentsCount}</p>
        </Card>
      </div>

      <Card>
        <h3 className="font-mono font-bold mb-4">Rating Distribution</h3>
        <div className="space-y-3">
          {[5, 4, 3, 2, 1].map(rating => {
            const count = stats.ratingDistribution[rating] || 0
            const percentage = stats.total > 0 ? (count / stats.total) * 100 : 0
            return (
              <div key={rating} className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold w-8">{rating}</span>
                <div className="flex-1 bg-gray-200 h-6 relative">
                  <div
                    className="bg-black h-full"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <span className="font-mono text-sm w-12 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </Card>

      {stats.comments.length > 0 && (
        <Card>
          <h3 className="font-mono font-bold mb-4">Comments</h3>
          <div className="space-y-4">
            {stats.comments.map((feedback: any, index: number) => (
              <div key={feedback.id || index} className="p-3 border border-gray-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex gap-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span
                        key={i}
                        className={`font-mono text-sm ${
                          i < feedback.rating ? 'text-black' : 'text-gray-300'
                        }`}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                  <span className="font-mono text-xs text-gray-600">
                    {new Date(feedback.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="font-mono text-sm">{feedback.comment}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
