/** Highlight resolvable file paths in children text nodes with dotted underline. */

import { Children, Fragment } from 'react'
import { PATH_COPIED_FEEDBACK_MS } from '../config/timing'
import { resolveEditorUrl } from '../utils/editorUrl'
import { computeHighlights } from '../utils/pathHighlights'

/**
 * Walks React children, processing only string nodes; resolved paths become clickable spans.
 * Click copies the host path; Alt+Click opens it in the editor when a template is configured.
 * @param {object} props
 * @param {React.ReactNode} props.children - Content to scan for paths.
 * @param {string|null} props.sessionDir - Host session directory (for /tmp resolution).
 * @param {Object<string, string>} props.resolvedPaths - Map of candidate -> resolved absolute path.
 * @param {string|null} [props.editorTemplate] - "Open in editor" URI template; null hides the Alt+Click hint.
 */
export default function PathHighlighter({
  children,
  sessionDir = null,
  resolvedPaths = {},
  editorTemplate = null,
}) {
  const hasResolved = resolvedPaths && Object.keys(resolvedPaths).length > 0
  if (!(sessionDir || hasResolved)) {
    return children
  }

  return processChildren(children, sessionDir, resolvedPaths, editorTemplate)
}

/** Recursively walk React children, highlighting paths in strings. */
function processChildren(children, sessionDir, resolvedPaths, editorTemplate) {
  return Children.map(children, child => {
    if (typeof child === 'string') {
      return highlightPaths(child, sessionDir, resolvedPaths, editorTemplate)
    }
    return child
  })
}

/** Split a string on resolved paths, returning mixed text and clickable spans. */
function highlightPaths(text, sessionDir, resolvedPaths, editorTemplate) {
  const highlights = computeHighlights(text, sessionDir, resolvedPaths)
  if (highlights.length === 0) {
    return text
  }

  const parts = []
  let lastIndex = 0

  for (const { start, end, candidate, resolved } of highlights) {
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start))
    }
    const title = editorTemplate ? `${resolved}\nAlt+Click to open in editor` : resolved
    parts.push(
      <span
        key={start}
        className="path-link"
        title={title}
        onClick={e => {
          // A path span carries no line information - always resolves to line 1.
          const editorUrl = e.altKey ? resolveEditorUrl(editorTemplate, { path: resolved }) : null
          if (editorUrl) {
            e.preventDefault()
            window.open(editorUrl, '_blank', 'noopener,noreferrer')
            return
          }
          navigator.clipboard.writeText(resolved)
          const el = e.currentTarget
          el.classList.add('copied')
          setTimeout(() => el.classList.remove('copied'), PATH_COPIED_FEEDBACK_MS)
        }}>
        {candidate}
      </span>,
    )
    lastIndex = end
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <Fragment>{parts}</Fragment>
}
