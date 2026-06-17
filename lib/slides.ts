import type { Slide, SlideBlock, SlideBlockType, SlideGradient } from '@/lib/types'

// Fixed design stage for slide decks. Block geometry (x/y/w/h on SlideBlock) is
// authored in these pixels; the editor and present view scale the whole stage to
// fit their container, so layouts stay resolution-independent (16:9).
export const SLIDE_STAGE_WIDTH = 1280
export const SLIDE_STAGE_HEIGHT = 720
export const SLIDE_ASPECT = SLIDE_STAGE_WIDTH / SLIDE_STAGE_HEIGHT

export interface SlideTheme {
  id: string
  name: string
  background: string
  surface: string
  color: string
  muted: string
  accent: string // = accents[0]; kept for backward-compat
  accents: string[]
  fontFamily: string
}

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
const SANS_FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'

// Curated mix: a clean mono default, calm clinical/professional palettes, and a
// vibrant Memphis set (reusing the certificate palette in lib/certificates/pdf.tsx).
export const SLIDE_THEMES: SlideTheme[] = [
  {
    id: 'default',
    name: 'Mono',
    background: '#ffffff',
    surface: '#f3f4f6',
    color: '#111111',
    muted: '#6b7280',
    accent: '#111111',
    accents: ['#111111', '#6b7280', '#9ca3af'],
    fontFamily: MONO_FONT,
  },
  {
    id: 'clinical',
    name: 'Clinical',
    background: '#f5f9ff',
    surface: '#e3edfb',
    color: '#0b2545',
    muted: '#5b6b85',
    accent: '#1d4ed8',
    accents: ['#1d4ed8', '#0891b2', '#0f766e', '#64748b'],
    fontFamily: SANS_FONT,
  },
  {
    id: 'professional',
    name: 'Professional',
    background: '#ffffff',
    surface: '#f3f4f6',
    color: '#1f2937',
    muted: '#6b7280',
    accent: '#0f766e',
    accents: ['#0f766e', '#b91c1c', '#1d4ed8', '#475569'],
    fontFamily: SANS_FONT,
  },
  {
    id: 'memphis',
    name: 'Memphis',
    background: '#fff7e6',
    surface: '#ffffff',
    color: '#1a1a2e',
    muted: '#6b7280',
    accent: '#e76f7a',
    accents: ['#e76f7a', '#5b8fb9', '#7ecdb0', '#f2d388', '#e8a0bf', '#1e2a5e'],
    fontFamily: SANS_FONT,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    background: '#0b1020',
    surface: '#1b2340',
    color: '#f5f5f5',
    muted: '#9aa4c0',
    accent: '#f2d388',
    accents: ['#f2d388', '#7ecdb0', '#e8a0bf', '#5b8fb9'],
    fontFamily: SANS_FONT,
  },
]

// Fixed swatches offered in the colour picker (the on-brand "Memphis" palette).
export const MEMPHIS_PALETTE = [
  '#1a1a2e', '#1e2a5e', '#5b8fb9', '#7ecdb0', '#f2d388',
  '#e76f7a', '#e8a0bf', '#d8d0e8', '#6b7280', '#ffffff',
]

export function getTheme(id: string): SlideTheme {
  return SLIDE_THEMES.find((t) => t.id === id) ?? SLIDE_THEMES[0]
}

/** Resolve a colour value: theme tokens like `theme:accent1` → the theme's hex;
 *  raw hex/CSS colours pass through unchanged. */
export function resolveColor(
  value: string | undefined,
  theme: SlideTheme
): string | undefined {
  if (!value) return undefined
  if (!value.startsWith('theme:')) return value
  const token = value.slice('theme:'.length)
  if (token === 'bg' || token === 'background') return theme.background
  if (token === 'text' || token === 'color') return theme.color
  if (token === 'surface') return theme.surface
  if (token === 'muted') return theme.muted
  if (token === 'accent') return theme.accent
  const m = token.match(/^accent(\d+)$/)
  if (m) return theme.accents[parseInt(m[1], 10) - 1] ?? theme.accent
  return undefined
}

export function gradientToCss(g: SlideGradient): string {
  const stops = g.stops.map((s) => `${s.color} ${s.pos}%`).join(', ')
  return `linear-gradient(${g.angle}deg, ${stops})`
}

export function createSlide(): Slide {
  return { id: crypto.randomUUID(), blocks: [] }
}

export interface SlideLayout {
  id: string
  name: string
}

export const SLIDE_LAYOUTS: SlideLayout[] = [
  { id: 'blank', name: 'Blank' },
  { id: 'title', name: 'Title' },
  { id: 'title-content', name: 'Title + content' },
  { id: 'two-column', name: 'Two columns' },
  { id: 'section', name: 'Section header' },
]

/** Build a slide pre-populated for a layout. Text colours use theme tokens so
 *  they follow the deck theme. */
export function createSlideFromLayout(layoutId: string): Slide {
  const id = crypto.randomUUID()
  const M = 80
  const cw = SLIDE_STAGE_WIDTH - 2 * M
  let z = 1
  const t = (
    content: string,
    x: number,
    y: number,
    w: number,
    h: number,
    style: SlideBlock['style']
  ): SlideBlock => ({ id: crypto.randomUUID(), type: 'text', x, y, w, h, z: z++, content, style })

  switch (layoutId) {
    case 'title':
      return {
        id,
        layout: 'title',
        blocks: [
          t('Presentation title', M, 270, cw, 130, { fontSize: 64, fontWeight: 'bold', align: 'center', color: 'theme:text' }),
          t('Subtitle', M, 420, cw, 80, { fontSize: 30, align: 'center', color: 'theme:muted' }),
        ],
      }
    case 'title-content':
      return {
        id,
        layout: 'title-content',
        blocks: [
          t('Title', M, 64, cw, 90, { fontSize: 46, fontWeight: 'bold', align: 'left', color: 'theme:text' }),
          t('•  Point one\n\n•  Point two\n\n•  Point three', M, 190, cw, 460, { fontSize: 30, align: 'left', color: 'theme:text' }),
        ],
      }
    case 'two-column':
      return {
        id,
        layout: 'two-column',
        blocks: [
          t('Title', M, 64, cw, 90, { fontSize: 46, fontWeight: 'bold', align: 'left', color: 'theme:text' }),
          t('•  Left point', M, 190, cw / 2 - 20, 460, { fontSize: 28, align: 'left', color: 'theme:text' }),
          t('•  Right point', M + cw / 2 + 20, 190, cw / 2 - 20, 460, { fontSize: 28, align: 'left', color: 'theme:text' }),
        ],
      }
    case 'section':
      return {
        id,
        layout: 'section',
        blocks: [t('Section', M, 300, cw, 140, { fontSize: 58, fontWeight: 'bold', align: 'center', color: 'theme:accent' })],
      }
    default:
      return { id, blocks: [] }
  }
}

/** A fresh block of the given type, positioned near the stage centre. New blocks
 *  reference theme colour tokens so they recolour when the theme changes. */
export function createBlock(type: SlideBlockType, _themeId: string): SlideBlock {
  const base = { id: crypto.randomUUID(), type, z: Date.now() }

  if (type === 'image') {
    return { ...base, x: 440, y: 160, w: 400, h: 300, content: '', style: {} }
  }
  if (type === 'shape') {
    return {
      ...base,
      x: 480,
      y: 260,
      w: 320,
      h: 200,
      content: '',
      style: { background: 'theme:accent1', shape: 'rectangle' },
    }
  }
  // text
  return {
    ...base,
    x: 140,
    y: 120,
    w: 1000,
    h: 160,
    content: 'New text',
    style: { fontSize: 48, color: 'theme:text', align: 'left', fontWeight: 'normal' },
  }
}
