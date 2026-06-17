'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { updateDeck } from '@/app/actions/presentations'
import {
  createSlide,
  createSlideFromLayout,
  createBlock,
  SLIDE_THEMES,
  SLIDE_LAYOUTS,
  SLIDE_STAGE_WIDTH,
  SLIDE_STAGE_HEIGHT,
  getTheme,
} from '@/lib/slides'
import { SlideStage } from '@/components/slides/SlideStage'
import { AIPanel } from '@/components/slides/AIPanel'
import { ColorPicker } from '@/components/slides/ColorPicker'
import { uploadSlideImage } from '@/app/actions/slide-uploads'
import { alignBlocks, distributeBlocks, type AlignEdge } from '@/lib/slides/arrange'
import { useUndoableState } from '@/hooks/useUndoableState'
import type { Presentation, Slide, SlideBlock, SlideBlockType, SlideGradient } from '@/lib/types'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function SlideEditor({
  deck,
  backHref,
  presentHref,
}: {
  deck: Presentation
  backHref: string
  presentHref: string
}) {
  const [title, setTitle] = useState(deck.title)
  const [theme, setTheme] = useState(deck.theme || 'default')
  const slidesStore = useUndoableState<Slide[]>(
    deck.slides?.length ? deck.slides : [createSlide()]
  )
  const slides = slidesStore.state
  const setSlides = slidesStore.set
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [rightTab, setRightTab] = useState<'design' | 'assistant'>('design')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [zoom, setZoom] = useState(1)
  const [showLayouts, setShowLayouts] = useState(false)
  const clipboardRef = useRef<SlideBlock[] | null>(null)
  const dragIndexRef = useRef<number | null>(null)

  // Debounced autosave. Skip the first render so opening a deck doesn't write.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setSaveState('saving')
    const t = setTimeout(() => {
      updateDeck(deck.id, { slides, title, theme })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'))
    }, 800)
    return () => clearTimeout(t)
  }, [slides, title, theme, deck.id])

  const clampedIndex = Math.min(activeIndex, slides.length - 1)
  const activeSlide = slides[clampedIndex]
  const selectedBlocks = activeSlide ? activeSlide.blocks.filter((b) => selectedIds.includes(b.id)) : []
  const selectedBlock = selectedBlocks.length === 1 ? selectedBlocks[0] : null
  function selectBlock(id: string | null, additive?: boolean) {
    if (id === null) {
      setSelectedIds([])
      return
    }
    setSelectedIds((prev) =>
      additive ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]
    )
  }

  // --- slide ops ---
  function patchActiveSlide(fn: (s: Slide) => Slide, coalesceKey?: string) {
    setSlides((prev) => prev.map((s, i) => (i === clampedIndex ? fn(s) : s)), coalesceKey)
  }
  function addSlide() {
    const slide = createSlide()
    setSlides((prev) => {
      const next = [...prev]
      next.splice(clampedIndex + 1, 0, slide)
      return next
    })
    setActiveIndex(clampedIndex + 1)
    setSelectedIds([])
  }
  function addLayoutSlide(layoutId: string) {
    const slide = createSlideFromLayout(layoutId)
    setSlides((prev) => {
      const next = [...prev]
      next.splice(clampedIndex + 1, 0, slide)
      return next
    })
    setActiveIndex(clampedIndex + 1)
    setSelectedIds([])
    setShowLayouts(false)
  }
  function duplicateSlide() {
    const src = slides[clampedIndex]
    const copy: Slide = {
      ...src,
      id: crypto.randomUUID(),
      blocks: src.blocks.map((b) => ({ ...b, id: crypto.randomUUID() })),
    }
    setSlides((prev) => {
      const next = [...prev]
      next.splice(clampedIndex + 1, 0, copy)
      return next
    })
    setActiveIndex(clampedIndex + 1)
    setSelectedIds([])
  }
  function deleteSlide() {
    setSelectedIds([])
    if (slides.length <= 1) {
      setSlides([createSlide()])
      setActiveIndex(0)
      return
    }
    setSlides((prev) => prev.filter((_, i) => i !== clampedIndex))
    setActiveIndex(Math.max(0, clampedIndex - 1))
  }
  function moveSlide(dir: -1 | 1) {
    const j = clampedIndex + dir
    if (j < 0 || j >= slides.length) return
    setSlides((prev) => {
      const next = [...prev]
      const [s] = next.splice(clampedIndex, 1)
      next.splice(j, 0, s)
      return next
    })
    setActiveIndex(j)
  }
  function reorderSlides(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return
    setSlides((prev) => {
      const next = [...prev]
      const [s] = next.splice(from, 1)
      next.splice(to, 0, s)
      return next
    })
    setActiveIndex(to)
    setSelectedIds([])
  }

  // --- block ops ---
  function addBlock(type: SlideBlockType) {
    const block = createBlock(type, theme)
    patchActiveSlide((s) => ({ ...s, blocks: [...s.blocks, block] }))
    setSelectedIds([block.id])
  }
  function changeBlock(id: string, patch: Partial<SlideBlock>, coalesceKey?: string) {
    patchActiveSlide(
      (s) => ({
        ...s,
        blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }),
      coalesceKey
    )
  }
  function changeBlockStyle(id: string, stylePatch: Partial<NonNullable<SlideBlock['style']>>) {
    patchActiveSlide(
      (s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.id === id ? { ...b, style: { ...b.style, ...stylePatch } } : b
        ),
      }),
      `style:${id}`
    )
  }
  function deleteBlock(id: string) {
    patchActiveSlide((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== id) }))
    setSelectedIds([])
  }
  function reorderBlock(id: string, dir: 'front' | 'back') {
    const zs = activeSlide.blocks.map((b) => b.z)
    const z = dir === 'front' ? Math.max(...zs) + 1 : Math.min(...zs) - 1
    changeBlock(id, { z })
  }

  // --- multi-block ops (selection-aware) ---
  function applyBlockPatches(patches: Record<string, { x?: number; y?: number }>) {
    patchActiveSlide((s) => ({
      ...s,
      blocks: s.blocks.map((b) => (patches[b.id] ? { ...b, ...patches[b.id] } : b)),
    }))
  }
  function deleteSelected() {
    if (!selectedIds.length) return
    const ids = new Set(selectedIds)
    patchActiveSlide((s) => ({ ...s, blocks: s.blocks.filter((b) => !ids.has(b.id)) }))
    setSelectedIds([])
  }
  function nudgeSelected(dx: number, dy: number) {
    if (!selectedIds.length) return
    const ids = new Set(selectedIds)
    patchActiveSlide(
      (s) => ({
        ...s,
        blocks: s.blocks.map((b) => (ids.has(b.id) ? { ...b, x: b.x + dx, y: b.y + dy } : b)),
      }),
      'nudge'
    )
  }
  function duplicateSelected() {
    if (!selectedIds.length) return
    const ids = new Set(selectedIds)
    const newIds: string[] = []
    patchActiveSlide((s) => {
      const copies = s.blocks
        .filter((b) => ids.has(b.id))
        .map((b) => {
          const id = crypto.randomUUID()
          newIds.push(id)
          return { ...b, id, x: b.x + 24, y: b.y + 24, z: Date.now() }
        })
      return { ...s, blocks: [...s.blocks, ...copies] }
    })
    setSelectedIds(newIds)
  }
  function copySelected() {
    if (selectedBlocks.length) clipboardRef.current = selectedBlocks
  }
  function pasteBlocks() {
    const items = clipboardRef.current
    if (!items?.length) return
    const newIds: string[] = []
    patchActiveSlide((s) => {
      const copies = items.map((b) => {
        const id = crypto.randomUUID()
        newIds.push(id)
        return { ...b, id, x: b.x + 24, y: b.y + 24, z: Date.now() }
      })
      return { ...s, blocks: [...s.blocks, ...copies] }
    })
    setSelectedIds(newIds)
  }
  function alignSelected(edge: AlignEdge) {
    applyBlockPatches(alignBlocks(selectedBlocks, edge))
  }
  function distributeSelected(axis: 'h' | 'v') {
    applyBlockPatches(distributeBlocks(selectedBlocks, axis))
  }

  // --- image ops ---
  function addImageBlock(url: string) {
    const block: SlideBlock = { ...createBlock('image', theme), content: url }
    patchActiveSlide((s) => ({ ...s, blocks: [...s.blocks, block] }))
    setSelectedIds([block.id])
  }
  async function handleCanvasDrop(e: React.DragEvent) {
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    e.preventDefault()
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('deckId', deck.id)
      const { url } = await uploadSlideImage(fd)
      addImageBlock(url)
    } catch (err) {
      console.error('Image drop upload failed:', err)
    }
  }

  // --- AI ops ---
  function applyAISlides(aiSlides: Slide[], mode: 'replace' | 'append') {
    if (aiSlides.length === 0) return
    setSelectedIds([])
    if (mode === 'replace') {
      setSlides(aiSlides)
      setActiveIndex(0)
    } else {
      const firstNew = slides.length
      setSlides((prev) => [...prev, ...aiSlides])
      setActiveIndex(firstNew)
    }
  }

  // Keep the latest values for the window keydown handler, which is bound once.
  const kbRef = useRef({
    selectedIds,
    undo: slidesStore.undo,
    redo: slidesStore.redo,
    deleteSelected,
    duplicateSelected,
    copySelected,
    pasteBlocks,
    nudgeSelected,
    setSelectedIds,
  })
  kbRef.current = {
    selectedIds,
    undo: slidesStore.undo,
    redo: slidesStore.redo,
    deleteSelected,
    duplicateSelected,
    copySelected,
    pasteBlocks,
    nudgeSelected,
    setSelectedIds,
  }

  useEffect(() => {
    function isEditableTarget() {
      const el = document.activeElement as HTMLElement | null
      return (
        !!el &&
        (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
      )
    }
    function onKeyDown(e: KeyboardEvent) {
      // While typing/editing, let the browser (and contentEditable) own the keys.
      if (isEditableTarget()) return
      const s = kbRef.current
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
        return
      }
      if (e.key === 'Escape') {
        s.setSelectedIds([])
        return
      }
      if (mod && key === 'v') {
        e.preventDefault()
        s.pasteBlocks()
        return
      }
      if (s.selectedIds.length === 0) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        s.deleteSelected()
        return
      }
      if (mod && key === 'd') {
        e.preventDefault()
        s.duplicateSelected()
        return
      }
      if (mod && key === 'c') {
        s.copySelected()
        return
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowLeft') s.nudgeSelected(-step, 0)
        else if (e.key === 'ArrowRight') s.nudgeSelected(step, 0)
        else if (e.key === 'ArrowUp') s.nudgeSelected(0, -step)
        else if (e.key === 'ArrowDown') s.nudgeSelected(0, step)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const saveLabel =
    saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-black px-4">
        <Link href={backHref} className="font-mono text-sm underline whitespace-nowrap">
          ← Session
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={slidesStore.undo}
            disabled={!slidesStore.canUndo}
            title="Undo (⌘Z)"
            className="border border-black px-2 py-0.5 font-mono text-xs hover:bg-gray-50 disabled:opacity-30"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={slidesStore.redo}
            disabled={!slidesStore.canRedo}
            title="Redo (⌘⇧Z)"
            className="border border-black px-2 py-0.5 font-mono text-xs hover:bg-gray-50 disabled:opacity-30"
          >
            ↷
          </button>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1 border-none bg-transparent font-mono text-sm font-bold outline-none"
          placeholder="Untitled deck"
        />
        <span
          className={`font-mono text-xs ${saveState === 'error' ? 'text-red-600' : 'text-gray-500'}`}
        >
          {saveLabel}
        </span>
        <label className="font-mono text-xs text-gray-500">
          Theme{' '}
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="border border-black bg-white px-1 py-0.5 font-mono text-xs"
          >
            {SLIDE_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <Link
          href={presentHref}
          target="_blank"
          className="border border-black bg-black px-3 py-1 font-mono text-xs text-white hover:bg-gray-800"
        >
          ▶ Present
        </Link>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Slide rail */}
        <div className="flex w-44 shrink-0 flex-col border-r border-black">
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            {slides.map((s, i) => (
              <button
                key={s.id}
                draggable
                onDragStart={() => {
                  dragIndexRef.current = i
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndexRef.current !== null) reorderSlides(dragIndexRef.current, i)
                  dragIndexRef.current = null
                }}
                onClick={() => {
                  setActiveIndex(i)
                  setSelectedIds([])
                }}
                className={`relative block w-full cursor-grab border active:cursor-grabbing ${
                  i === clampedIndex ? 'border-black ring-2 ring-black' : 'border-gray-300'
                }`}
              >
                <span className="absolute left-0 top-0 z-10 bg-black px-1 font-mono text-[10px] text-white">
                  {i + 1}
                </span>
                <div className="pointer-events-none">
                  <SlideStage slide={s} themeId={theme} interactive={false} />
                </div>
              </button>
            ))}
          </div>
          <div className="relative shrink-0 border-t border-black">
            {showLayouts && (
              <div className="absolute bottom-full left-0 right-0 z-20 border border-black bg-white">
                {SLIDE_LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => addLayoutSlide(l.id)}
                    className="block w-full px-3 py-2 text-left font-mono text-xs hover:bg-gray-50"
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex">
              <button
                onClick={addSlide}
                className="flex-1 bg-black px-3 py-2 font-mono text-sm text-white hover:bg-gray-800"
              >
                + Add slide
              </button>
              <button
                onClick={() => setShowLayouts((v) => !v)}
                title="Add slide from layout"
                className="border-l border-white/30 bg-black px-3 py-2 font-mono text-sm text-white hover:bg-gray-800"
              >
                ▾
              </button>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex min-w-0 flex-1 flex-col bg-gray-100">
          <div className="flex shrink-0 items-center gap-2 border-b border-black bg-white px-3 py-2">
            <span className="font-mono text-xs text-gray-500">Insert:</span>
            <ToolbarButton onClick={() => addBlock('text')}>Text</ToolbarButton>
            <ToolbarButton onClick={() => addBlock('image')}>Image</ToolbarButton>
            <ToolbarButton onClick={() => addBlock('shape')}>Shape</ToolbarButton>
            <div className="ml-auto flex items-center gap-2 font-mono text-xs text-gray-500">
              <span>
                Slide {clampedIndex + 1} / {slides.length}
              </span>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
                className="border border-black px-2 py-0.5 hover:bg-gray-50"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                title="Reset zoom"
                className="w-12 border border-black px-1 py-0.5 hover:bg-gray-50"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
                className="border border-black px-2 py-0.5 hover:bg-gray-50"
              >
                +
              </button>
            </div>
          </div>
          <div
            className="flex min-h-0 flex-1 items-start overflow-auto p-6"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleCanvasDrop}
          >
            <div className="mx-auto shrink-0 border border-black shadow-sm" style={{ width: `${zoom * 100}%` }}>
              {activeSlide && (
                <SlideStage
                  slide={activeSlide}
                  themeId={theme}
                  interactive
                  selectedIds={selectedIds}
                  onSelectBlock={selectBlock}
                  onChangeBlock={changeBlock}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right column: Design / Assistant */}
        <div className="flex w-80 shrink-0 flex-col border-l border-black">
          <div className="flex shrink-0 border-b border-black">
            <RightTab active={rightTab === 'design'} onClick={() => setRightTab('design')}>
              Design
            </RightTab>
            <RightTab active={rightTab === 'assistant'} onClick={() => setRightTab('assistant')}>
              ✦ Assistant
            </RightTab>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {rightTab === 'design' ? (
              <div className="p-3">
                {selectedBlocks.length > 1 ? (
                  <MultiInspector
                    count={selectedBlocks.length}
                    onAlign={alignSelected}
                    onDistribute={distributeSelected}
                    onDelete={deleteSelected}
                  />
                ) : selectedBlock ? (
                  <BlockInspector
                    block={selectedBlock}
                    themeId={theme}
                    deckId={deck.id}
                    onChange={(patch) => changeBlock(selectedBlock.id, patch)}
                    onChangeStyle={(stylePatch) => changeBlockStyle(selectedBlock.id, stylePatch)}
                    onReorder={(dir) => reorderBlock(selectedBlock.id, dir)}
                    onDelete={() => deleteBlock(selectedBlock.id)}
                  />
                ) : (
                  <SlideInspector
                    slide={activeSlide}
                    themeId={theme}
                    onBackground={(color) =>
                      patchActiveSlide((s) => ({ ...s, background: color, backgroundGradient: undefined }))
                    }
                    onGradient={(gradient) =>
                      patchActiveSlide((s) => ({ ...s, backgroundGradient: gradient }))
                    }
                    onNotes={(notes) => patchActiveSlide((s) => ({ ...s, notes }))}
                    onDuplicate={duplicateSlide}
                    onDelete={deleteSlide}
                    onMoveUp={() => moveSlide(-1)}
                    onMoveDown={() => moveSlide(1)}
                    canMoveUp={clampedIndex > 0}
                    canMoveDown={clampedIndex < slides.length - 1}
                  />
                )}
              </div>
            ) : (
              <AIPanel
                deckId={deck.id}
                theme={theme}
                currentSlides={slides}
                onApply={applyAISlides}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RightTab({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 border-r border-black px-2 py-2 font-mono text-xs last:border-r-0 ${
        active ? 'bg-black text-white' : 'bg-white hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

function ToolbarButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="border border-black bg-white px-3 py-1 font-mono text-xs hover:bg-gray-50"
    >
      + {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  )
}

function MiniButton({
  active,
  children,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`border border-black px-2 py-1 font-mono text-xs ${
        active ? 'bg-black text-white' : 'bg-white hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

function MultiInspector({
  count,
  onAlign,
  onDistribute,
  onDelete,
}: {
  count: number
  onAlign: (edge: AlignEdge) => void
  onDistribute: (axis: 'h' | 'v') => void
  onDelete: () => void
}) {
  return (
    <div>
      <h3 className="mb-1 font-mono text-sm font-bold">{count} blocks selected</h3>
      <p className="mb-3 font-mono text-[11px] text-gray-500">
        Shift-click blocks to add/remove. Arrows nudge the group.
      </p>
      <Field label="Align">
        <div className="grid grid-cols-3 gap-1">
          <MiniButton onClick={() => onAlign('left')}>L</MiniButton>
          <MiniButton onClick={() => onAlign('centerH')}>C</MiniButton>
          <MiniButton onClick={() => onAlign('right')}>R</MiniButton>
          <MiniButton onClick={() => onAlign('top')}>T</MiniButton>
          <MiniButton onClick={() => onAlign('middle')}>M</MiniButton>
          <MiniButton onClick={() => onAlign('bottom')}>B</MiniButton>
        </div>
      </Field>
      <Field label="Distribute (3+)">
        <div className="flex gap-1">
          <MiniButton onClick={() => onDistribute('h')}>Horizontal</MiniButton>
          <MiniButton onClick={() => onDistribute('v')}>Vertical</MiniButton>
        </div>
      </Field>
      <button
        onClick={onDelete}
        className="mt-2 w-full border border-red-600 bg-white px-2 py-1 font-mono text-xs text-red-600 hover:bg-red-50"
      >
        Delete blocks
      </button>
    </div>
  )
}

function ImageUploadField({
  deckId,
  onUploaded,
}: {
  deckId: string
  onUploaded: (url: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Field label="Upload image">
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          setBusy(true)
          setErr(null)
          try {
            const fd = new FormData()
            fd.append('file', file)
            fd.append('deckId', deckId)
            const { url } = await uploadSlideImage(fd)
            onUploaded(url)
          } catch (uploadError) {
            setErr(uploadError instanceof Error ? uploadError.message : 'Upload failed')
          } finally {
            setBusy(false)
          }
        }}
        className="w-full font-mono text-[11px]"
      />
      {busy && <p className="mt-1 font-mono text-[10px] text-gray-500">Uploading…</p>}
      {err && <p className="mt-1 font-mono text-[10px] text-red-600">{err}</p>}
    </Field>
  )
}

const FONT_OPTIONS = [
  { label: 'Theme', value: '' },
  { label: 'Sans', value: 'ui-sans-serif, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, Cambria, Times New Roman, serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
]

function BlockInspector({
  block,
  themeId,
  deckId,
  onChange,
  onChangeStyle,
  onReorder,
  onDelete,
}: {
  block: SlideBlock
  themeId: string
  deckId: string
  onChange: (patch: Partial<SlideBlock>) => void
  onChangeStyle: (stylePatch: Partial<NonNullable<SlideBlock['style']>>) => void
  onReorder: (dir: 'front' | 'back') => void
  onDelete: () => void
}) {
  const s = block.style ?? {}
  return (
    <div>
      <h3 className="mb-3 font-mono text-sm font-bold capitalize">{block.type} block</h3>

      {block.type === 'text' && (
        <>
          <Field label="Font size">
            <input
              type="number"
              min={8}
              max={200}
              value={s.fontSize ?? 48}
              onChange={(e) => onChangeStyle({ fontSize: Number(e.target.value) })}
              className="w-full border border-black px-2 py-1 font-mono text-xs"
            />
          </Field>
          <Field label="Font">
            <select
              value={s.fontFamily ?? ''}
              onChange={(e) => onChangeStyle({ fontFamily: e.target.value || undefined })}
              className="w-full border border-black px-1 py-1 font-mono text-xs"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.label} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Style">
            <div className="flex gap-1">
              <MiniButton
                active={s.fontWeight === 'bold'}
                onClick={() => onChangeStyle({ fontWeight: s.fontWeight === 'bold' ? 'normal' : 'bold' })}
              >
                B
              </MiniButton>
              <MiniButton active={!!s.italic} onClick={() => onChangeStyle({ italic: !s.italic })}>
                I
              </MiniButton>
            </div>
          </Field>
          <Field label="Align">
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map((a) => (
                <MiniButton key={a} active={(s.align ?? 'left') === a} onClick={() => onChangeStyle({ align: a })}>
                  {a[0].toUpperCase()}
                </MiniButton>
              ))}
            </div>
          </Field>
          <Field label="Text colour">
            <ColorPicker value={s.color} themeId={themeId} onChange={(v) => onChangeStyle({ color: v })} />
          </Field>
          <Field label="Highlight">
            <ColorPicker value={s.highlight} themeId={themeId} allowNone onChange={(v) => onChangeStyle({ highlight: v || undefined })} />
          </Field>
        </>
      )}

      {block.type === 'image' && (
        <>
          <Field label="Image URL">
            <input
              type="url"
              value={block.content}
              placeholder="https://…"
              onChange={(e) => onChange({ content: e.target.value })}
              className="w-full border border-black px-2 py-1 font-mono text-xs"
            />
          </Field>
          <ImageUploadField deckId={deckId} onUploaded={(url) => onChange({ content: url })} />
        </>
      )}

      {block.type === 'shape' && (
        <>
          <Field label="Shape">
            <div className="flex flex-wrap gap-1">
              {(['rectangle', 'rounded', 'ellipse', 'triangle'] as const).map((sh) => (
                <MiniButton
                  key={sh}
                  active={(s.shape ?? 'rectangle') === sh}
                  onClick={() => onChangeStyle({ shape: sh })}
                >
                  {sh[0].toUpperCase() + sh.slice(1)}
                </MiniButton>
              ))}
            </div>
          </Field>
          <Field label="Fill">
            <ColorPicker value={s.background} themeId={themeId} onChange={(v) => onChangeStyle({ background: v })} />
          </Field>
          <Field label="Border colour">
            <ColorPicker value={s.borderColor} themeId={themeId} allowNone onChange={(v) => onChangeStyle({ borderColor: v || undefined })} />
          </Field>
          <Field label="Border width">
            <input
              type="number"
              min={0}
              max={40}
              value={s.borderWidth ?? 0}
              onChange={(e) => onChangeStyle({ borderWidth: Number(e.target.value) || undefined })}
              className="w-full border border-black px-2 py-1 font-mono text-xs"
            />
          </Field>
        </>
      )}

      <Field label="Opacity">
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round((block.opacity ?? 1) * 100)}
          onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
          className="w-full"
        />
      </Field>

      <Field label="Align to slide">
        <div className="grid grid-cols-3 gap-1">
          <MiniButton onClick={() => onChange({ x: 0 })}>L</MiniButton>
          <MiniButton onClick={() => onChange({ x: Math.round((SLIDE_STAGE_WIDTH - block.w) / 2) })}>C</MiniButton>
          <MiniButton onClick={() => onChange({ x: SLIDE_STAGE_WIDTH - block.w })}>R</MiniButton>
          <MiniButton onClick={() => onChange({ y: 0 })}>T</MiniButton>
          <MiniButton onClick={() => onChange({ y: Math.round((SLIDE_STAGE_HEIGHT - block.h) / 2) })}>M</MiniButton>
          <MiniButton onClick={() => onChange({ y: SLIDE_STAGE_HEIGHT - block.h })}>B</MiniButton>
        </div>
      </Field>

      <Field label="Arrange">
        <div className="flex gap-1">
          <MiniButton onClick={() => onReorder('front')}>To front</MiniButton>
          <MiniButton onClick={() => onReorder('back')}>To back</MiniButton>
        </div>
      </Field>

      <button
        onClick={onDelete}
        className="mt-2 w-full border border-red-600 bg-white px-2 py-1 font-mono text-xs text-red-600 hover:bg-red-50"
      >
        Delete block
      </button>
    </div>
  )
}

function SlideInspector({
  slide,
  themeId,
  onBackground,
  onGradient,
  onNotes,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  slide: Slide | undefined
  themeId: string
  onBackground: (color: string) => void
  onGradient: (gradient: SlideGradient | undefined) => void
  onNotes: (notes: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  if (!slide) return null
  const grad = slide.backgroundGradient
  return (
    <div>
      <h3 className="mb-3 font-mono text-sm font-bold">Slide</h3>
      <p className="mb-3 font-mono text-[11px] text-gray-500">
        Select a block to edit it, or double-click text to type.
      </p>

      <Field label="Background">
        <ColorPicker value={slide.background} themeId={themeId} onChange={onBackground} />
      </Field>

      <Field label="Gradient">
        {grad ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ColorPicker
                value={grad.stops[0]?.color}
                themeId={themeId}
                onChange={(v) =>
                  onGradient({ ...grad, stops: [{ color: v, pos: 0 }, grad.stops[1] ?? { color: '#ffffff', pos: 100 }] })
                }
              />
              <ColorPicker
                value={grad.stops[1]?.color}
                themeId={themeId}
                onChange={(v) =>
                  onGradient({ ...grad, stops: [grad.stops[0] ?? { color: '#000000', pos: 0 }, { color: v, pos: 100 }] })
                }
              />
            </div>
            <label className="block font-mono text-[11px] text-gray-500">
              Angle {grad.angle}°
              <input
                type="range"
                min={0}
                max={360}
                value={grad.angle}
                onChange={(e) => onGradient({ ...grad, angle: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <MiniButton onClick={() => onGradient(undefined)}>Remove gradient</MiniButton>
          </div>
        ) : (
          <MiniButton
            onClick={() =>
              onGradient({ type: 'linear', angle: 135, stops: [{ color: '#5b8fb9', pos: 0 }, { color: '#7ecdb0', pos: 100 }] })
            }
          >
            Add gradient
          </MiniButton>
        )}
      </Field>

      <Field label="Speaker notes">
        <textarea
          value={slide.notes ?? ''}
          onChange={(e) => onNotes(e.target.value)}
          rows={4}
          className="w-full border border-black px-2 py-1 font-mono text-xs"
          placeholder="Notes for the presenter…"
        />
      </Field>

      <Field label="Arrange slide">
        <div className="flex gap-1">
          <MiniButton onClick={onMoveUp}>{canMoveUp ? '↑ Up' : '↑'}</MiniButton>
          <MiniButton onClick={onMoveDown}>{canMoveDown ? '↓ Down' : '↓'}</MiniButton>
          <MiniButton onClick={onDuplicate}>Duplicate</MiniButton>
        </div>
      </Field>

      <button
        onClick={onDelete}
        className="mt-2 w-full border border-red-600 bg-white px-2 py-1 font-mono text-xs text-red-600 hover:bg-red-50"
      >
        Delete slide
      </button>
    </div>
  )
}
