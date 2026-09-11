import { useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { parseExcalidraw, serializeExcalidraw, buildFileContent } from '../lib/excalidraw'

interface Props {
  content: string
  fileName: string
}

type SceneState =
  | { elements: unknown[]; appState?: Record<string, unknown> }
  | { error: Error }

/** Only appState keys worth persisting; the rest are runtime noise that would flag false dirty. */
function pickAppState(appState?: Record<string, unknown>) {
  return { viewBackgroundColor: appState?.viewBackgroundColor ?? '#ffffff' }
}

export default function ExcalidrawView({ content, fileName }: Props) {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [viewMode, setViewMode] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const latestRef = useRef<{ elements: unknown[]; appState: Record<string, unknown> } | null>(null)
  const compareRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedJsonRef = useRef('')
  const syncedContentRef = useRef<string | null>(null)

  const [scene, setScene] = useState<SceneState>(() => {
    try {
      return parseExcalidraw(content)
    } catch (e) {
      return { error: e as Error }
    }
  })

  useEffect(() => {
    try {
      const next = parseExcalidraw(content)
      setScene(next)
      savedJsonRef.current = serializeExcalidraw(next.elements, pickAppState(next.appState))
      setDirty(false)
      // On mount, initialData already carries the scene — only sync live updates
      // from external file changes after that (calling updateScene during mount
      // races with Excalidraw's internal state init and crashes it).
      if (syncedContentRef.current !== null && syncedContentRef.current !== content) {
        apiRef.current?.updateScene({
          elements: next.elements as never,
          appState: pickAppState(next.appState) as never,
        })
      }
      syncedContentRef.current = content
    } catch (e) {
      setScene({ error: e as Error })
    }
  }, [content])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  if ('error' in scene) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚠️</div>
        <p>Excalidraw 解析失败：{scene.error.message}</p>
      </div>
    )
  }

  const save = async () => {
    if (!latestRef.current) return
    const json = serializeExcalidraw(
      latestRef.current.elements,
      pickAppState(latestRef.current.appState),
    )
    const next = buildFileContent(content, fileName, json)
    const r = await window.viewer.saveFile(fileName, next)
    if (r.ok) {
      savedJsonRef.current = json
      setDirty(false)
    } else {
      window.alert('保存失败：' + (r.error ?? '未知错误'))
    }
  }

  const enterEditMode = () => {
    setConfirmDiscard(false)
    setViewMode(false)
  }

  const exitEditMode = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true)
      setTimeout(() => setConfirmDiscard(false), 3000)
      return
    }
    setDirty(false)
    setConfirmDiscard(false)
    latestRef.current = null
    setViewMode(true)
  }

  return (
    <div className="excalidraw-wrap">
      <Excalidraw
        initialData={
          {
            elements: scene.elements as never,
            // plain-object appState skips Excalidraw's internal Map init for
            // collaborators (a viewMode code path reads it on 2nd render and
            // crashes); hand it an empty array so .forEach exists.
            appState: { ...pickAppState(scene.appState), collaborators: [] },
          } as never
        }
        excalidrawAPI={(api) => (apiRef.current = api)}
        onChange={(elements, appState) => {
          latestRef.current = { elements: elements as unknown[], appState: appState as never }
          clearTimeout(compareRef.current)
          compareRef.current = setTimeout(() => {
            if (!latestRef.current) return
            const json = serializeExcalidraw(
              latestRef.current.elements,
              pickAppState(latestRef.current.appState),
            )
            setDirty(json !== savedJsonRef.current)
          }, 200)
        }}
        viewModeEnabled={viewMode}
        theme={dark ? 'dark' : 'light'}
        langCode="zh-CN"
      />
      <div className="viewer-toolbar">
        {viewMode ? (
          <button title="编辑" onClick={enterEditMode}>
            ✏️ 编辑
          </button>
        ) : (
          <>
            <button title={dirty ? '保存到文件' : '已保存'} onClick={save} disabled={!dirty}>
              💾 {dirty ? '保存*' : '已保存'}
            </button>
            <button
              title={confirmDiscard ? '再点一次确认丢弃' : '切回查看模式'}
              className={confirmDiscard ? 'danger' : ''}
              onClick={exitEditMode}
            >
              {confirmDiscard ? '⚠️ 确认丢弃' : '👁 查看'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
