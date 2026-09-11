import LZString from 'lz-string'

export interface ExcalidrawScene {
  elements: unknown[]
  appState?: Record<string, unknown>
}

/**
 * Accepts:
 *  - plain `.excalidraw` / `.excalidraw.json` (raw scene JSON)
 *  - Obsidian `.excalidraw.md` (scene JSON embedded after the "## Drawing"
 *    heading, either raw between %% markers or LZ-string compressed in a
 *    ```compressed-json code block)
 */
export function parseExcalidraw(content: string): ExcalidrawScene {
  const tryParse = (text: string): ExcalidrawScene | null => {
    try {
      const data = JSON.parse(text)
      if (Array.isArray(data)) return { elements: data }
      if (data && Array.isArray(data.elements)) {
        return { elements: data.elements, appState: data.appState }
      }
    } catch {
      /* not JSON */
    }
    return null
  }

  // 1. raw scene JSON
  const direct = tryParse(content)
  if (direct) return direct

  // 2. Obsidian compressed-json block (LZ-string base64, possibly line-wrapped)
  const compressed = content.match(/```compressed-json\n([\s\S]*?)```/)
  if (compressed) {
    const json = LZString.decompressFromBase64(compressed[1].replace(/\s+/g, ''))
    if (json) {
      const scene = tryParse(json)
      if (scene) return scene
    }
  }

  // 3. "## Drawing" section with embedded JSON
  const drawingPart = content.split(/^## Drawing\s*$/m)[1]
  if (drawingPart) {
    const start = drawingPart.indexOf('{')
    const end = drawingPart.lastIndexOf('}')
    if (start !== -1 && end > start) {
      const scene = tryParse(drawingPart.slice(start, end + 1))
      if (scene) return scene
    }
  }

  // 4. last resort: first %%...%% block anywhere in the file
  const m = content.match(/%%([\s\S]*?)%%/)
  if (m) {
    const scene = tryParse(m[1].trim())
    if (scene) return scene
  }

  throw new Error('无法解析 Excalidraw 数据')
}

/** Serialize current scene state back to Excalidraw scene JSON. */
export function serializeExcalidraw(
  elements: unknown[],
  appState?: Record<string, unknown>,
): string {
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'md-viewer',
      elements,
      appState: appState ?? {},
      files: {},
    },
    null,
    2,
  )
}

/**
 * Build the new file content after an edit.
 * Preserves the original file's structure:
 *  - plain `.excalidraw` / `.excalidraw.json`: whole file becomes scene JSON
 *  - Obsidian compressed `.excalidraw.md`: only the base64 payload is swapped
 *  - Obsidian plain `.excalidraw.md`: only the JSON inside %% markers is swapped
 */
export function buildFileContent(
  original: string,
  filePath: string,
  sceneJson: string,
): string {
  if (/\.excalidraw(\.json)?$/i.test(filePath)) return sceneJson

  if (/```compressed-json\n[\s\S]*?```/.test(original)) {
    // wrap at 150 chars to mimic the plugin's line-broken base64 layout
    const payload = LZString.compressToBase64(sceneJson).replace(/(.{150})/g, '$1\n')
    return original.replace(
      /```compressed-json\n[\s\S]*?```/,
      '```compressed-json\n' + payload + '\n```',
    )
  }

  if (original.includes('## Drawing')) {
    const start = original.indexOf('%%')
    if (start !== -1) {
      const end = original.indexOf('%%', start + 2)
      if (end !== -1) {
        return (
          original.slice(0, start + 2) +
          '\n' +
          sceneJson +
          '\n' +
          original.slice(end)
        )
      }
    }
  }

  return `# Excalidraw Data\n\n## Drawing\n\n%%\n${sceneJson}\n%%\n`
}
