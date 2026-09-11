import type { Mermaid } from 'mermaid'

let mermaidPromise: Promise<Mermaid> | null = null
let renderSeq = 0

const svgCache = new Map<string, string>()

/** Lazily load mermaid (~1MB) only when the first diagram is encountered. */
function ensureMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'strict',
        fontFamily: 'inherit',
      })
      return mermaid
    })
  }
  return mermaidPromise
}

/**
 * Render mermaid source to an SVG string (cached by source text).
 * Throws with a readable message when the diagram is invalid.
 */
export async function renderMermaid(code: string): Promise<string> {
  const cached = svgCache.get(code)
  if (cached !== undefined) return cached

  const mermaid = await ensureMermaid()
  const id = `mdv-mermaid-${++renderSeq}`
  try {
    const { svg } = await mermaid.render(id, code)
    if (svgCache.size > 100) svgCache.clear()
    svgCache.set(code, svg)
    return svg
  } catch (e) {
    throw new Error((e as Error).message || 'invalid diagram')
  }
}
