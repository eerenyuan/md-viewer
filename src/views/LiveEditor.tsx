import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { livePreview } from '../lib/cm-live-preview'

interface Props {
  /** Current file content (external source of truth when not dirty). */
  content: string
  dirSlash: string
  dark: boolean
  onDirtyChange: (dirty: boolean) => void
  viewRef: React.MutableRefObject<EditorView | null>
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.75',
    overflowY: 'auto',
  },
  '.cm-content': {
    maxWidth: '916px',
    margin: '0 auto',
    padding: '28px 16px 120px',
    caretColor: '#0969da',
  },
  '.cm-line': { padding: '0 4px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftWidth: '2px', borderLeftColor: '#0969da' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(84, 174, 255, 0.25) !important',
  },
})

const lightTheme = EditorView.theme({ '&': { color: '#1f2328' } }, { dark: false })
const darkTheme = EditorView.theme({ '&': { color: '#e6edf3' } }, { dark: true })

export default function LiveEditor({ content, dirSlash, dark, onDirtyChange, viewRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const themeComp = useRef(new Compartment())
  const suppressDirty = useRef(false)
  const onDirtyRef = useRef(onDirtyChange)
  onDirtyRef.current = onDirtyChange

  useEffect(() => {
    const view = new EditorView({
      doc: content,
      parent: hostRef.current!,
      extensions: [
        baseTheme,
        themeComp.current.of(dark ? darkTheme : lightTheme),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
        livePreview(dirSlash),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !suppressDirty.current) onDirtyRef.current(true)
        }),
      ],
    })
    viewRef.current = view
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // follow external content changes (AI / other editors) when the buffer is clean
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur !== content) {
      suppressDirty.current = true
      view.dispatch({ changes: { from: 0, to: cur.length, insert: content } })
      suppressDirty.current = false
    }
  }, [content])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.current.reconfigure(dark ? darkTheme : lightTheme),
    })
  }, [dark])

  return <div ref={hostRef} className="live-editor" />
}
