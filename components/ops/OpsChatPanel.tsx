'use client'

import { useEffect, useRef, useState } from 'react'
import { getChatThread, sendChatMessage } from '@/app/actions/ops-chat'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'
import type { OpsChatThread } from '@/lib/types'

interface DisplayMessage {
  role: 'user' | 'assistant'
  content: string
  toolSummary?: { name: string; ok: boolean }[] | null
}

interface OpsChatPanelProps {
  threads: OpsChatThread[]
}

const STARTER_PROMPTS = [
  'Which upcoming sessions still have no confirmed speaker?',
  'Summarise the feedback themes from recent sessions.',
  'Which sessions have the lowest aggregate feedback this term?',
  'How do teaching slots and claiming work?',
]

export function OpsChatPanel({ threads: initialThreads }: OpsChatPanelProps) {
  const [threads, setThreads] = useState(initialThreads)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function openThread(threadId: string) {
    setError(null)
    setActiveThreadId(threadId)
    try {
      const { messages: loaded } = await getChatThread(threadId)
      setMessages(
        loaded.map((m) => ({ role: m.role, content: m.content, toolSummary: m.tool_summary }))
      )
    } catch {
      setError('Could not load that conversation.')
      setMessages([])
    }
  }

  function newThread() {
    setActiveThreadId(null)
    setMessages([])
    setError(null)
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])

    try {
      const result = await sendChatMessage(activeThreadId, trimmed)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.reply, toolSummary: result.toolSummary },
      ])
      if (!activeThreadId) {
        setActiveThreadId(result.threadId)
        setThreads((prev) => [
          {
            id: result.threadId,
            org_id: '',
            user_id: '',
            title: trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          ...prev,
        ])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant hit an unexpected error.')
      setMessages((prev) => prev.slice(0, -1))
      setInput(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* Thread sidebar */}
      <div className="border border-black bg-white">
        <div className="flex items-center justify-between border-b border-black px-3 py-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider">
            Conversations
          </span>
          <button
            type="button"
            onClick={newThread}
            className="font-mono text-xs underline underline-offset-2 hover:text-clay-700"
          >
            + New
          </button>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {threads.length === 0 ? (
            <p className="px-3 py-4 font-mono text-xs text-gray-500">No conversations yet.</p>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => openThread(thread.id)}
                className={cn(
                  'block w-full border-b border-gray-200 px-3 py-2 text-left font-mono text-xs last:border-b-0 hover:bg-gray-50',
                  activeThreadId === thread.id && 'bg-clay-50 font-bold'
                )}
              >
                <span className="line-clamp-2">{thread.title}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex min-h-[520px] flex-col border border-black bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && !busy ? (
            <div>
              <p className="mb-3 font-mono text-sm text-gray-600">
                Ask about your sessions, speakers, feedback themes, attendance
                coverage — or how anything on the platform works. Any email it
                drafts waits for your approval.
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => send(prompt)}
                    className="border border-black bg-white px-3 py-1.5 text-left font-mono text-xs hover:bg-gray-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] border px-3 py-2',
                    message.role === 'user'
                      ? 'border-clay-600 bg-clay-50'
                      : 'border-black bg-white'
                  )}
                >
                  {message.toolSummary && message.toolSummary.length > 0 && (
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-gray-400">
                      Used: {message.toolSummary.map((t) => t.name).join(', ')}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap font-mono text-sm">{message.content}</p>
                </div>
              </div>
            ))
          )}
          {busy && (
            <div className="flex justify-start">
              <div className="border border-black bg-white px-3 py-2">
                <p className="font-mono text-sm text-gray-500">Thinking…</p>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="border-t border-red-700 bg-red-50 px-4 py-2 font-mono text-xs text-red-700">
            {error}
          </p>
        )}

        <form
          className="flex gap-2 border-t border-black p-3"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the assistant…"
            disabled={busy}
            className="min-w-0 flex-1 border border-black px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-clay-600"
          />
          <Button type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Working…' : 'Send'}
          </Button>
        </form>
      </div>
    </div>
  )
}
