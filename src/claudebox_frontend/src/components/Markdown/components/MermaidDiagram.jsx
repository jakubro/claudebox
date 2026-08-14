/** Mermaid diagram renderer with toggle-to-source, zoom overlay, and error fallback. */

import { Code, X } from 'lucide-react'
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import { MERMAID_FAILURE_NOTICE_DELAY_MS } from '../../../config/timing'
import {
  getCachedMermaidSvg,
  removeMermaidRenderArtifacts,
  renderMermaidChart,
} from '../../../utils/mermaidLoader'
import CopyButton from '../../CopyButton.jsx'

// Prefix for the failure notice - the specific reason (mermaid's own error message), when present, follows it.
const MERMAID_FAILURE_PREFIX = 'Diagram failed to draw'

/**
 * @param {Object} props
 * @param {string} props.chart - Raw mermaid source text.
 */
function MermaidDiagram({ chart }) {
  const [svg, setSvg] = useState(() => getCachedMermaidSvg(chart))
  // null = no failure; otherwise the (possibly empty) reason mermaid threw.
  const [failureMessage, setFailureMessage] = useState(null)
  // Gates WHEN the notice appears (not what it says) - see the settle-window effect below.
  const [noticeVisible, setNoticeVisible] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const renderRef = useRef(null)
  const reactId = useId()
  const renderIdRef = useRef(0)

  useEffect(() => {
    // A remounted instance restores immediately - no loading placeholder, no redraw.
    const cached = getCachedMermaidSvg(chart)
    if (cached) {
      setSvg(cached)
      setFailureMessage(null)
      setNoticeVisible(false)
      return
    }

    let cancelled = false
    let noticeTimer = null
    renderIdRef.current += 1
    const renderId = `mermaid-${reactId.replace(/:/g, '')}-${renderIdRef.current}`

    async function render() {
      try {
        const { svg: rendered } = await renderMermaidChart(renderId, chart)
        if (!cancelled) {
          setSvg(rendered)
          setFailureMessage(null)
          setNoticeVisible(false)
        }
      } catch (err) {
        if (!cancelled) {
          const message = typeof err?.message === 'string' ? err.message : ''
          setFailureMessage(message)
          setSvg(null)
          setNoticeVisible(false)
          // Reveal after the settle window; a chart that keeps changing (streaming) cancels this via cleanup.
          noticeTimer = setTimeout(() => {
            if (!cancelled) {
              setNoticeVisible(true)
            }
          }, MERMAID_FAILURE_NOTICE_DELAY_MS)
        }
        removeMermaidRenderArtifacts(renderId)
      }
    }

    render()
    return () => {
      cancelled = true
      if (noticeTimer) {
        clearTimeout(noticeTimer)
      }
    }
  }, [chart, reactId])

  const handleToggle = useCallback(() => setShowSource(s => !s), [])
  const handleZoomOpen = useCallback(() => setZoomed(true), [])
  const handleZoomClose = useCallback(() => setZoomed(false), [])

  // Document-level Escape listener - div onKeyDown requires focus which overlay doesn't have
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

  if (failureMessage !== null) {
    return (
      <div className="code-block-wrapper">
        <CopyButton text={chart} className="code-copy-btn" title="Copy code" size={12} />
        {noticeVisible && (
          <div className="mermaid-failure-notice">
            <span className="mermaid-failure-icon" aria-hidden="true">
              !
            </span>
            <span className="mermaid-failure-text">
              {MERMAID_FAILURE_PREFIX}
              {failureMessage ? ` - ${failureMessage}` : ''}
            </span>
          </div>
        )}
        <SyntaxHighlighter style={vs2015} language="mermaid" PreTag="div">
          {chart}
        </SyntaxHighlighter>
      </div>
    )
  }

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
      {/* Portal the zoom overlay to body so it escapes the turn's containment (otherwise the fixed overlay is clipped to the turn box). */}
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

// Memoize on chart - avoids remounts that would drop the drawn diagram, zoom state, and source toggle.
export default memo(MermaidDiagram)
