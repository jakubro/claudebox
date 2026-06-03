/** Highlight resolvable file paths in children text nodes with dotted underline. */

import { Children, Fragment } from 'react'
import { PATH_COPIED_FEEDBACK_MS } from '../config/timing'
import { computeHighlights } from '../utils/pathHighlights'

/**
 * Highlight resolvable file paths in children text nodes with dotted underline.
 *
 * Walks React children, processes only string nodes. Resolved paths render as
 * clickable spans that copy the absolute host path to clipboard on click.
 * @param {object} props
 * @param {React.ReactNode} props.children - Content to scan for paths.
 * @param {string|null} props.sessionDir - Host session directory (for /tmp resolution).
 * @param {Object<string, string>} props.resolvedPaths - Map of candidate -> resolved absolute path.
 */
export default function PathHighlighter({ children, sessionDir = null, resolvedPaths = {} }) {
  const hasResolved = resolvedPaths && Object.keys(resolvedPaths).length > 0
  if (!(sessionDir || hasResolved)) {
    return children
  }

  return processChildren(children, sessionDir, resolvedPaths)
}

/** Recursively walk React children, highlighting paths in strings. */
function processChildren(children, sessionDir, resolvedPaths) {
  return Children.map(children, child => {
    if (typeof child === 'string') {
      return highlightPaths(child, sessionDir, resolvedPaths)
    }
    return child
  })
}

/** Split a string on resolved paths, returning mixed text and clickable spans. */
function highlightPaths(text, sessionDir, resolvedPaths) {
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
    parts.push(
      <span
        key={start}
        className="path-link"
        title={resolved}
        onClick={e => {
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
