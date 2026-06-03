/** Mermaid diagram renderer with toggle-to-source, zoom overlay, and error fallback. */

import { Code, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import { renderMermaidChart } from '../utils/mermaidLoader'
import CopyButton from './CopyButton.jsx'

/**
 * Render a mermaid code block as an SVG diagram with toggle and zoom.
 * @param {Object} props
 * @param {string} props.chart - Raw mermaid source text.
 */
export default function MermaidDiagram({ chart }) {
  const [svg, setSvg] = useState(null)
  const [error, setError] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const renderRef = useRef(null)
  const reactId = useId()
  const renderIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    renderIdRef.current += 1
    const renderId = `mermaid-${reactId.replace(/:/g, '')}-${renderIdRef.current}`

    async function render() {
      try {
        const { svg: rendered } = await renderMermaidChart(renderId, chart)
        if (!cancelled) {
          setSvg(rendered)
          setError(false)
        }
      } catch {
        if (!cancelled) {
          setError(true)
          setSvg(null)
        }
        // Clean up orphaned render element mermaid may have left in DOM
        const orphan = document.getElementById(renderId)
        if (orphan) {
          orphan.remove()
        }
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [chart, reactId])

  const handleToggle = useCallback(() => setShowSource(s => !s), [])
  const handleZoomOpen = useCallback(() => setZoomed(true), [])
  const handleZoomClose = useCallback(() => setZoomed(false), [])

  // Document-level Escape listener — div onKeyDown requires focus which overlay doesn't have
  useEffect(() => {
    if (!zoomed) {
      return
    }
    const onKeyDown = e => {
      if (e.key === 'Escape') {
        handleZoomClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [zoomed, handleZoomClose])

  const handleBackdropClick = useCallback(
    e => {
      if (e.target === e.currentTarget) {
        handleZoomClose()
      }
    },
    [handleZoomClose],
  )

  // Error fallback — render as syntax-highlighted code silently
  if (error) {
    return (
      <div className="code-block-wrapper">
        <CopyButton text={chart} className="code-copy-btn" title="Copy code" size={12} />
        <SyntaxHighlighter style={vs2015} language="mermaid" PreTag="div">
          {chart}
        </SyntaxHighlighter>
      </div>
    )
  }

  // Source view toggle
  if (showSource) {
    return (
      <div className="mermaid-container">
        <div className="mermaid-toolbar preview-toolbar">
          <button
            type="button"
            className="mermaid-toolbar-btn preview-toolbar-btn pressed"
            onClick={handleToggle}
            title="Show diagram">
            <Code size={14} />
          </button>
          <CopyButton text={chart} size={12} title="Copy source" />
        </div>
        <SyntaxHighlighter style={vs2015} language="mermaid" PreTag="div">
          {chart}
        </SyntaxHighlighter>
      </div>
    )
  }

  // Diagram view (loading or rendered)
  return (
    <div className="mermaid-container">
      <div className="mermaid-toolbar preview-toolbar">
        <button
          type="button"
          className="mermaid-toolbar-btn preview-toolbar-btn"
          onClick={handleToggle}
          title="Show source">
          <Code size={14} />
        </button>
        <CopyButton text={chart} size={12} title="Copy source" />
      </div>
      {svg ? (
        <div
          ref={renderRef}
          className="mermaid-diagram"
          onClick={handleZoomOpen}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid SVG output is sanitized by strict security level
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="mermaid-loading">Rendering diagram...</div>
      )}
      {/* Portal the zoom overlay to body so it escapes ancestor `content-visibility`/
          paint-containment (otherwise the fixed overlay is clipped to the turn box). */}
      {zoomed &&
        createPortal(
          <div className="mermaid-zoom-overlay" onClick={handleBackdropClick}>
            <button
              type="button"
              className="zoom-overlay-close"
              onClick={handleZoomClose}
              title="Close">
              <X size={20} />
            </button>
            <div
              className="mermaid-zoom-content"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid SVG output is sanitized by strict security level
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
