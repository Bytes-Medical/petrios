'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { StarterKit } from '@tiptap/starter-kit'
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'

/**
 * Inline rich-text editor for a text block. Edits HTML; commits on blur. The
 * bubble toolbar is portalled outside the scaled stage, so the CSS transform
 * doesn't distort it. StarterKit (v3) already bundles Underline.
 */
export default function RichTextBlock({
  initialHtml,
  style,
  onCommit,
}: {
  initialHtml: string
  style: React.CSSProperties
  onCommit: (html: string) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: initialHtml,
    autofocus: 'end',
    editorProps: {
      attributes: { style: 'outline:none;width:100%;height:100%;' },
    },
    onBlur: ({ editor }) => onCommit(editor.getHTML()),
  })

  return (
    <div style={style} onMouseDown={(e) => e.stopPropagation()}>
      {editor && (
        <BubbleMenu editor={editor}>
          <div className="flex items-center gap-0.5 border border-black bg-white p-1 shadow-lg">
            <TB onClick={() => editor.chain().focus().toggleBold().run()}>B</TB>
            <TB onClick={() => editor.chain().focus().toggleItalic().run()} italic>
              I
            </TB>
            <TB onClick={() => editor.chain().focus().toggleUnderline().run()}>U̲</TB>
            <TB onClick={() => editor.chain().focus().toggleStrike().run()}>S̶</TB>
            <span className="mx-1 text-gray-300">|</span>
            <TB onClick={() => editor.chain().focus().toggleBulletList().run()}>•</TB>
            <TB onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</TB>
            <span className="mx-1 text-gray-300">|</span>
            <TB onClick={() => editor.chain().focus().setTextAlign('left').run()}>⇤</TB>
            <TB onClick={() => editor.chain().focus().setTextAlign('center').run()}>≡</TB>
            <TB onClick={() => editor.chain().focus().setTextAlign('right').run()}>⇥</TB>
            <span className="mx-1 text-gray-300">|</span>
            <select
              onChange={(e) => e.target.value && editor.chain().focus().setFontSize(e.target.value).run()}
              defaultValue=""
              title="Font size"
              className="border border-black px-1 py-0.5 font-mono text-[11px]"
            >
              <option value="" disabled>
                Size
              </option>
              {[16, 24, 32, 40, 48, 64, 88].map((s) => (
                <option key={s} value={`${s}px`}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="color"
              title="Text colour"
              onInput={(e) => editor.chain().focus().setColor(e.currentTarget.value).run()}
              className="h-6 w-6 border border-black p-0"
            />
            <TB onClick={() => editor.chain().focus().toggleHighlight({ color: '#fde68a' }).run()}>
              ▰
            </TB>
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function TB({
  children,
  onClick,
  italic,
}: {
  children: React.ReactNode
  onClick: () => void
  italic?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-w-[24px] border border-transparent px-1 py-0.5 font-mono text-xs hover:border-black ${
        italic ? 'italic' : ''
      }`}
    >
      {children}
    </button>
  )
}
