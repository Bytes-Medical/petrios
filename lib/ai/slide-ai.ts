import { SLIDE_STAGE_WIDTH as W } from '@/lib/slides'
import type { Slide, SlideBlock } from '@/lib/types'
import { askClaude, isClaudeConfigured } from '@/lib/ai/claude'

// The model produces *semantic* slides (no geometry). A deterministic layout
// step (layoutGeneratedSlides) turns these into positioned blocks, so model
// output stays simple and reliable across providers. Claude (ANTHROPIC_API_KEY)
// is preferred; an OpenAI-compatible endpoint (SLIDE_AI_BASE_URL) is the
// self-hosted alternative.
export type GeneratedLayout = 'title' | 'bullets' | 'section' | 'statement'

export interface GeneratedSlide {
  title?: string
  layout?: GeneratedLayout
  bullets?: string[]
  body?: string
  notes?: string
}

export interface AuthorRequest {
  mode: 'generate' | 'edit'
  prompt: string
  currentSlides?: Slide[]
  theme: string
}

export interface AuthorResult {
  slides: Slide[]
  message: string
  usedModel: boolean
}

const SYSTEM_PROMPT = `You are a medical education assistant that drafts teaching slides for NHS trainees.
Rules:
- Content must be clinically accurate and reflect current UK / NHS and national guideline practice where relevant.
- Be concise: each bullet <= ~12 words; 3-6 bullets per content slide.
- Do NOT fabricate references, statistics, or drug doses you are unsure of.
- Output ONLY a single JSON object. No prose, no markdown code fences.

JSON schema:
{"slides":[{"title":string,"layout":"title"|"bullets"|"section"|"statement","bullets":string[],"body":string,"notes":string}]}

Guidance:
- Start with a "title" slide, then a "bullets" slide of learning objectives.
- Use "bullets" for most content slides, "section" for dividers, "statement" for a single key message.
- End with a "bullets" summary / key-points slide.
- Add a brief presenter "notes" string to each slide.`

function slidesToText(slides: Slide[]): string {
  return slides
    .map((s, i) => {
      const text = s.blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.content)
        .filter(Boolean)
        .join('\n')
      return `Slide ${i + 1}:\n${text || '(empty)'}`
    })
    .join('\n\n')
}

function buildUserPrompt(req: AuthorRequest): string {
  if (req.mode === 'edit') {
    return [
      'Here is the current deck:',
      '"""',
      slidesToText(req.currentSlides ?? []),
      '"""',
      `Apply this instruction and return the COMPLETE updated deck as JSON: "${req.prompt}"`,
    ].join('\n')
  }
  return `Create a teaching deck of 8-12 slides on the topic: "${req.prompt}". Target audience: NHS trainees.`
}

/** Calls the configured model: Claude when ANTHROPIC_API_KEY is set, else an
 *  OpenAI-compatible chat endpoint (vLLM/TGI/Ollama/OpenAI). Returns null when
 *  neither is configured so callers can fall back offline. */
async function callModel(system: string, user: string): Promise<string | null> {
  if (isClaudeConfigured()) {
    return askClaude({ system, prompt: user, maxTokens: 8192 })
  }

  const baseUrl = process.env.SLIDE_AI_BASE_URL
  if (!baseUrl) return null

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.SLIDE_AI_API_KEY
        ? { Authorization: `Bearer ${process.env.SLIDE_AI_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      model: process.env.SLIDE_AI_MODEL || 'epfl-llm/meditron-7b',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: 2048,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Model endpoint error ${res.status}: ${detail.slice(0, 200)}`)
  }

  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? null
}

function coerceGeneratedSlide(x: unknown): GeneratedSlide {
  if (!x || typeof x !== 'object') return {}
  const o = x as Record<string, unknown>
  const layouts: GeneratedLayout[] = ['title', 'bullets', 'section', 'statement']
  return {
    title: typeof o.title === 'string' ? o.title : undefined,
    layout: layouts.includes(o.layout as GeneratedLayout) ? (o.layout as GeneratedLayout) : undefined,
    bullets: Array.isArray(o.bullets) ? o.bullets.map(String).map((s) => s.trim()).filter(Boolean) : undefined,
    body:
      typeof o.body === 'string'
        ? o.body
        : typeof o.content === 'string'
          ? o.content
          : undefined,
    notes:
      typeof o.notes === 'string'
        ? o.notes
        : typeof o.speaker_notes === 'string'
          ? o.speaker_notes
          : undefined,
  }
}

function parseGeneratedSlides(text: string): GeneratedSlide[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.search(/[[{]/)
  if (start === -1) throw new Error('Model did not return JSON')
  const candidate = cleaned.slice(start)

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    // Trim trailing junk back to the last closing bracket and retry.
    const lastBrace = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    if (lastBrace === -1) throw new Error('Could not parse model JSON')
    parsed = JSON.parse(candidate.slice(0, lastBrace + 1))
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as { slides?: unknown[] })?.slides
  if (!Array.isArray(arr)) throw new Error('Model output missing a "slides" array')

  return arr
    .map(coerceGeneratedSlide)
    .filter((s) => s.title || s.body || (s.bullets && s.bullets.length))
}

/** Offline starter outline when no model endpoint is configured. */
function stubGenerate(req: AuthorRequest): GeneratedSlide[] {
  if (req.mode === 'edit') return []
  const topic = req.prompt.trim() || 'Teaching session'
  return [
    { layout: 'title', title: topic, body: 'A teaching session for NHS trainees' },
    {
      layout: 'bullets',
      title: 'Learning objectives',
      bullets: [
        `Recognise and define ${topic}`,
        'Understand the underlying mechanisms',
        'Outline assessment and investigations',
        'Describe evidence-based management',
      ],
      notes: 'Set expectations for the session.',
    },
    {
      layout: 'bullets',
      title: 'Overview',
      bullets: [`What is ${topic}?`, 'Epidemiology and risk factors', 'Why it matters clinically'],
    },
    {
      layout: 'bullets',
      title: 'Assessment & investigations',
      bullets: ['Focused history and examination', 'Bedside and laboratory tests', 'Imaging where indicated'],
    },
    {
      layout: 'bullets',
      title: 'Management',
      bullets: ['Initial / acute management', 'Definitive treatment', 'When to escalate or refer'],
    },
    {
      layout: 'bullets',
      title: 'Key points',
      bullets: [`Recognise ${topic} early`, 'Follow local and national guidelines', 'Safety-net and document clearly'],
    },
  ]
}

function layoutOne(g: GeneratedSlide): Slide {
  const M = 80
  const contentW = W - 2 * M
  const blocks: SlideBlock[] = []
  let z = 1
  const push = (b: Omit<SlideBlock, 'id' | 'z'>) =>
    blocks.push({ id: crypto.randomUUID(), z: z++, ...b })

  const layout: GeneratedLayout =
    g.layout || (g.bullets?.length ? 'bullets' : g.body ? 'statement' : 'title')

  if (layout === 'title') {
    if (g.title)
      push({ type: 'text', x: M, y: 260, w: contentW, h: 160, content: g.title, style: { fontSize: 64, fontWeight: 'bold', align: 'center', color: 'theme:text' } })
    if (g.body)
      push({ type: 'text', x: M, y: 440, w: contentW, h: 120, content: g.body, style: { fontSize: 30, align: 'center', color: 'theme:muted' } })
  } else if (layout === 'section') {
    push({ type: 'text', x: M, y: 300, w: contentW, h: 160, content: g.title || g.body || '', style: { fontSize: 58, fontWeight: 'bold', align: 'center', color: 'theme:accent' } })
  } else if (layout === 'statement') {
    push({ type: 'text', x: M, y: 240, w: contentW, h: 240, content: g.body || g.title || '', style: { fontSize: 40, fontWeight: 'bold', align: 'center', color: 'theme:text' } })
  } else {
    // bullets
    if (g.title)
      push({ type: 'text', x: M, y: 64, w: contentW, h: 100, content: g.title, style: { fontSize: 46, fontWeight: 'bold', align: 'left', color: 'theme:accent' } })
    const body =
      g.bullets && g.bullets.length ? g.bullets.map((b) => `•  ${b}`).join('\n\n') : g.body || ''
    push({ type: 'text', x: M, y: 190, w: contentW, h: 460, content: body, style: { fontSize: 30, align: 'left', color: 'theme:text' } })
  }

  return { id: crypto.randomUUID(), blocks, notes: g.notes }
}

export function layoutGeneratedSlides(gen: GeneratedSlide[], _themeId: string): Slide[] {
  return gen.map((g) => layoutOne(g))
}

/** Generate or edit a deck. Uses the configured model endpoint, or an offline
 *  starter outline when none is set. */
export async function authorDeck(req: AuthorRequest): Promise<AuthorResult> {
  const raw = await callModel(SYSTEM_PROMPT, buildUserPrompt(req))

  const usedModel = raw != null
  const gen = usedModel ? parseGeneratedSlides(raw as string) : stubGenerate(req)

  if (req.mode === 'edit' && gen.length === 0) {
    return {
      slides: req.currentSlides ?? [],
      message: usedModel
        ? 'No changes were proposed.'
        : 'AI editing needs a model — set ANTHROPIC_API_KEY (Claude) or SLIDE_AI_BASE_URL (self-hosted).',
      usedModel,
    }
  }

  const slides = layoutGeneratedSlides(gen, req.theme)
  const message = usedModel
    ? `Drafted ${slides.length} slide${slides.length === 1 ? '' : 's'}. Review for clinical accuracy before teaching.`
    : `Generated a ${slides.length}-slide starter outline. This is a placeholder — set ANTHROPIC_API_KEY (Claude) for researched content.`

  return { slides, message, usedModel }
}
