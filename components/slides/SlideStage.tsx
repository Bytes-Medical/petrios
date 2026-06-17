'use client'

import { Rnd } from 'react-rnd'
import dynamic from 'next/dynamic'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  SLIDE_STAGE_WIDTH as W,
  SLIDE_STAGE_HEIGHT as H,
  getTheme,
  resolveColor,
  gradientToCss,
  type SlideTheme,
} from '@/lib/slides'
import { computeSnap, type Rect } from '@/lib/slides/snapping'
import type { Slide, SlideBlock } from '@/lib/types'

// Rich-text editor is client-only (TipTap); the static path never needs it.
const RichTextBlock = dynamic(() => import('@/components/slides/RichTextBlock'), { ssr: false })

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Seed the rich-text editor from a legacy plain-text block (preserves lines). */
function plainToHtml(text: string): string {
  if (!text) return '<p></p>'
  return text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('')
}

interface SlideStageProps {
  slide: Slide
  themeId: string
  /** Editable canvas (react-rnd) vs. static render (thumbnails / present mode). */
  interactive?: boolean
  selectedIds?: string[]
  onSelectBlock?: (id: string | null, additive?: boolean) => void
  onChangeBlock?: (id: string, patch: Partial<SlideBlock>) => void
  className?: string
}

/**
 * Renders one slide on a fixed W×H stage scaled to fill its container width.
 * react-rnd is told the same `scale` so drag/resize deltas map back to stage px.
 */
export function SlideStage({
  slide,
  themeId,
  interactive = false,
  selectedIds = [],
  onSelectBlock,
  onChangeBlock,
  className,
}: SlideStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [guides, setGuides] = useState<{ axis: 'x' | 'y'; pos: number }[]>([])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / W)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const theme = getTheme(themeId)
  const background = slide.backgroundGradient
    ? gradientToCss(slide.backgroundGradient)
    : resolveColor(slide.background, theme) || theme.background

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', aspectRatio: `${W} / ${H}`, overflow: 'hidden' }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: W,
          height: H,
          background,
          fontFamily: theme.fontFamily,
          color: theme.color,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
        onMouseDown={
          interactive
            ? (e) => {
                if (e.target === e.currentTarget) onSelectBlock?.(null, false)
              }
            : undefined
        }
      >
        {scale > 0 &&
          [...slide.blocks]
            .sort((a, b) => a.z - b.z)
            .map((block) =>
              interactive ? (
                <InteractiveBlock
                  key={block.id}
                  block={block}
                  theme={theme}
                  scale={scale}
                  siblings={slide.blocks.filter((b) => b.id !== block.id)}
                  selected={selectedIds.includes(block.id)}
                  editing={editingId === block.id}
                  onSelect={(additive) => onSelectBlock?.(block.id, additive)}
                  onStartEdit={() => {
                    onSelectBlock?.(block.id, false)
                    setEditingId(block.id)
                  }}
                  onEndEdit={() => setEditingId(null)}
                  onChange={(patch) => onChangeBlock?.(block.id, patch)}
                  onGuides={setGuides}
                />
              ) : (
                <div
                  key={block.id}
                  style={{
                    position: 'absolute',
                    left: block.x,
                    top: block.y,
                    width: block.w,
                    height: block.h,
                    zIndex: block.z,
                    opacity: block.opacity ?? 1,
                    transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
                  }}
                >
                  <BlockContent block={block} theme={theme} />
                </div>
              )
            )}

        {interactive &&
          guides.map((g, i) =>
            g.axis === 'x' ? (
              <div
                key={i}
                style={{ position: 'absolute', left: g.pos, top: 0, width: 1, height: H, background: '#ef4444', pointerEvents: 'none', zIndex: 9999 }}
              />
            ) : (
              <div
                key={i}
                style={{ position: 'absolute', top: g.pos, left: 0, height: 1, width: W, background: '#ef4444', pointerEvents: 'none', zIndex: 9999 }}
              />
            )
          )}
      </div>
    </div>
  )
}

interface InteractiveBlockProps {
  block: SlideBlock
  theme: SlideTheme
  scale: number
  siblings: SlideBlock[]
  selected: boolean
  editing: boolean
  onSelect: (additive?: boolean) => void
  onStartEdit: () => void
  onEndEdit: () => void
  onChange: (patch: Partial<SlideBlock>) => void
  onGuides: (guides: { axis: 'x' | 'y'; pos: number }[]) => void
}

function InteractiveBlock({
  block,
  theme,
  scale,
  siblings,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onChange,
  onGuides,
}: InteractiveBlockProps) {
  const others: Rect[] = siblings.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
  return (
    <Rnd
      scale={scale}
      bounds="parent"
      size={{ width: block.w, height: block.h }}
      position={{ x: block.x, y: block.y }}
      disableDragging={editing}
      enableResizing={selected && !editing}
      onDragStart={() => onSelect(false)}
      onDrag={(_e, d) => {
        const snap = computeSnap({ x: d.x, y: d.y, w: block.w, h: block.h }, others)
        onGuides(snap.guides)
      }}
      onDragStop={(_e, d) => {
        const snap = computeSnap({ x: d.x, y: d.y, w: block.w, h: block.h }, others)
        onGuides([])
        onChange({ x: Math.round(snap.x), y: Math.round(snap.y) })
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        onGuides([])
        onChange({
          w: Math.round(ref.offsetWidth),
          h: Math.round(ref.offsetHeight),
          x: Math.round(pos.x),
          y: Math.round(pos.y),
        })
      }}
      style={{
        zIndex: block.z,
        opacity: block.opacity ?? 1,
        outline: selected ? `2px solid ${theme.accent}` : '1px dashed rgba(0,0,0,0.15)',
        outlineOffset: 0,
        cursor: editing ? 'text' : 'move',
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (!editing) onSelect(e.shiftKey)
      }}
      onDoubleClick={() => {
        if (block.type === 'text') onStartEdit()
      }}
    >
      <BlockContent
        block={block}
        theme={theme}
        editing={editing}
        onCommit={(html) => {
          onChange({ html })
          onEndEdit()
        }}
      />
    </Rnd>
  )
}

function blockTextStyle(block: SlideBlock, theme: SlideTheme): React.CSSProperties {
  const s = block.style ?? {}
  return {
    width: '100%',
    height: '100%',
    fontSize: s.fontSize ?? 48,
    fontWeight: s.fontWeight ?? 'normal',
    fontStyle: s.italic ? 'italic' : 'normal',
    textAlign: s.align ?? 'left',
    color: resolveColor(s.color, theme) ?? theme.color,
    background: resolveColor(s.highlight, theme),
    fontFamily: s.fontFamily,
    lineHeight: s.lineHeight ?? 1.2,
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    outline: 'none',
  }
}

interface BlockContentProps {
  block: SlideBlock
  theme: SlideTheme
  editing?: boolean
  onCommit?: (html: string) => void
}

function BlockContent({ block, theme, editing, onCommit }: BlockContentProps) {
  if (block.type === 'image') {
    return block.content ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={block.content}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
      />
    ) : (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed #bbb',
          color: '#999',
          fontSize: 20,
          textAlign: 'center',
          padding: 12,
        }}
      >
        Image — paste a URL in the panel →
      </div>
    )
  }

  if (block.type === 'shape') {
    const s = block.style ?? {}
    const fill = resolveColor(s.background, theme) || theme.accent
    const border = s.borderWidth
      ? `${s.borderWidth}px ${s.borderStyle ?? 'solid'} ${resolveColor(s.borderColor, theme) ?? theme.color}`
      : undefined
    if (s.shape === 'triangle') {
      // clip-path can't show a border; fill only.
      return <div style={{ width: '100%', height: '100%', background: fill, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }} />
    }
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: fill,
          border,
          borderRadius:
            s.shape === 'ellipse' ? '50%' : s.shape === 'rounded' ? (s.radius ?? 16) : (s.radius ?? 0),
        }}
      />
    )
  }

  // text
  const ts = blockTextStyle(block, theme)
  if (editing && onCommit) {
    return <RichTextBlock initialHtml={block.html ?? plainToHtml(block.content)} style={ts} onCommit={onCommit} />
  }
  if (block.html) {
    // HTML is sanitised on save (updateDeck); author's in-memory edits are their own.
    return <div style={ts} dangerouslySetInnerHTML={{ __html: block.html }} />
  }
  return <div style={ts}>{block.content}</div>
}
