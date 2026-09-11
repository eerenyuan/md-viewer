import { useEffect, useState } from 'react'

export interface TocHeading {
  id: string
  text: string
  level: number
}

/** Live element lookup by id — immune to container innerHTML rewrites. */
function headingEl(id: string): HTMLElement | null {
  return document.getElementById(id)
}

interface Props {
  headings: TocHeading[]
}

/** Right-side outline panel with current-section highlight. */
export default function TocPanel({ headings }: Props) {
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    const scrollHost = document.querySelector<HTMLElement>('.md-scroll')
    if (!scrollHost) return

    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        let cur: TocHeading | null = null
        for (const h of headings) {
          const el = headingEl(h.id)
          if (el && el.getBoundingClientRect().top <= 90) cur = h
          else break
        }
        setCurrent(cur?.id ?? null)
      })
    }
    onScroll()
    scrollHost.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      scrollHost.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav className="toc-panel">
      <h4>目录</h4>
      {headings.map((h) => (
        <a
          key={h.id}
          className={`toc-item l${h.level} ${h.id === current ? 'current' : ''}`}
          title={h.text}
          onClick={(e) => {
            e.preventDefault()
            headingEl(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          {h.text}
        </a>
      ))}
    </nav>
  )
}
