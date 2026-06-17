'use client'

import { useRef, useState } from 'react'
import { generateSlides } from '@/app/actions/slide-ai'
import type { Slide } from '@/lib/types'

interface Message {
  role: 'user' | 'assistant'
  text: string
  proposal?: Slide[]
}

export function AIPanel({
  deckId,
  theme,
  currentSlides,
  onApply,
}: {
  deckId: string
  theme: string
  currentSlides: Slide[]
  onApply: (slides: Slide[], mode: 'replace' | 'append') => void
}) {
  const [topic, setTopic] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function run(mode: 'generate' | 'edit', prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    setMessages((m) => [...m, { role: 'user', text: trimmed }])
    if (mode === 'generate') setTopic('')
    else setInput('')

    try {
      const res = await generateSlides({ deckId, mode, prompt: trimmed, currentSlides, theme })
      setMessages((m) => [...m, { role: 'assistant', text: res.message, proposal: res.slides }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(false)
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Deep research */}
      <div className="shrink-0 border-b border-gray-200 p-3">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-gray-500">
          Research a topic
        </p>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={2}
          placeholder="e.g. Community-acquired pneumonia"
          className="w-full border border-black px-2 py-1 font-mono text-xs"
        />
        <button
          onClick={() => run('generate', topic)}
          disabled={busy || !topic.trim()}
          className="mt-2 w-full border border-black bg-black px-3 py-2 font-mono text-xs text-white hover:bg-gray-800 disabled:opacity-40"
        >
          {busy ? 'Researching…' : '✦ Generate deck'}
        </button>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="font-mono text-[11px] leading-relaxed text-gray-500">
            Generate a full deck from a topic above, or type an instruction below to revise the
            current slides — e.g. “add a slide on antibiotic choice”, “make slide 3 more concise”.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-full border px-2 py-1 text-left font-mono text-xs ${
                m.role === 'user' ? 'border-black bg-gray-100' : 'border-gray-300 bg-white'
              }`}
            >
              {m.text}
            </div>
            {m.proposal && m.proposal.length > 0 && (
              <div className="mt-1 flex gap-1">
                <button
                  onClick={() => onApply(m.proposal!, 'replace')}
                  className="border border-black bg-white px-2 py-1 font-mono text-[11px] hover:bg-gray-50"
                >
                  Replace deck ({m.proposal.length})
                </button>
                <button
                  onClick={() => onApply(m.proposal!, 'append')}
                  className="border border-black bg-white px-2 py-1 font-mono text-[11px] hover:bg-gray-50"
                >
                  Append
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && <p className="font-mono text-[11px] text-gray-400">Thinking…</p>}
        {error && (
          <div className="border border-red-500 bg-red-50 p-2 font-mono text-[11px] text-red-800">
            {error}
          </div>
        )}
      </div>

      {/* Instruction input */}
      <div className="shrink-0 border-t border-black p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              run('edit', input)
            }
          }}
          rows={2}
          placeholder="Ask the assistant to change the slides…"
          className="w-full border border-black px-2 py-1 font-mono text-xs"
        />
        <button
          onClick={() => run('edit', input)}
          disabled={busy || !input.trim()}
          className="mt-2 w-full border border-black bg-white px-3 py-2 font-mono text-xs hover:bg-gray-50 disabled:opacity-40"
        >
          Send
        </button>
        <p className="mt-2 font-mono text-[10px] leading-snug text-gray-400">
          AI-generated content. Always verify clinical accuracy against current guidelines before
          teaching.
        </p>
      </div>
    </div>
  )
}
