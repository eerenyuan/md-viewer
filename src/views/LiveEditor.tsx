import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
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
  /** Source offset the caret should start at (keeps view-mode scroll position). */
  initialPos?: number
  /** Document zoom factor (Ctrl+wheel). */
  zoom?: number
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.75',
    overflowY: 'auto',
  },
  '.cm-content': {
    margin: '0 auto',
    padding: '28px 48px 120px',
    caretColor: '#0969da',
  },
  '.cm-line': { padding: '0 4px' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftWidth: '2.5px',
    borderLeftColor: '#0969da',
    boxShadow: '0 0 4px rgba(9, 105, 218, 0.9)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(84, 174, 255, 0.25) !important',
  },
})

const lightTheme = EditorView.theme({ '&': { color: '#1f2328' } }, { dark: false })
const darkTheme = EditorView.theme({ '&': { color: '#e6edf3' } }, { dark: true })

export default function LiveEditor({ content, dirSlash, dark, onDirtyChange, viewRef, initialPos = 0, zoom = 1 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const themeComp = useRef(new Compartment())
  const suppressDirty = useRef(false)
  const onDirtyRef = useRef(onDirtyChange)
  onDirtyRef.current = onDirtyChange

  useEffect(() => {
    const anchor = Math.max(0, Math.min(initialPos, content.length))
    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        selection: { anchor },
        extensions: [
          baseTheme,
          themeComp.current.of(dark ? darkTheme : lightTheme),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
        highlightActiveLine(),
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
          livePreview(dirSlash),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !suppressDirty.current) onDirtyRef.current(true)
          }),
        ],
      }),
      parent: hostRef.current!,
    })
    viewRef.current = view
    ;(window as unknown as { __cmView?: EditorView | null }).__cmView = view
    // scroll after the first layout measure — dispatching scrollIntoView on an
    // unmeasured viewport scrolls to a guessed position; focusing first also
    // fights the native focus-scroll, so dispatch then focus in the same frame.
    // rAF can stall forever (occluded/minimized window) — keep a timer fallback.
    const applyScroll = () => {
      if (viewRef.current !== view) return
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: 'start' }),
      })
      view.focus()
    }
    let applied = false
    const once = () => {
      if (applied) return
      applied = true
      applyScroll()
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(once)
    })
    setTimeout(once, 80)
    return () => {
      view.destroy()
      viewRef.current = null
      if ((window as unknown as { __cmView?: EditorView | null }).__cmView === view) {
        ;(window as unknown as { __cmView?: EditorView | null }).__cmView = null
      }
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

  return <div ref={hostRef} className="live-editor" style={{ zoom }} />
}
