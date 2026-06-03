/** Unified code block renderer with table layout and sticky gutter. */

import { useMemo } from 'react'
import CodeBlockLine from './CodeBlockLine'
import { computeColumnWidths } from './utils/columnWidths'

/**
 * Render a code block with optional sticky gutter columns.
 * @param {object} props
 * @param {Array} props.lines - Array of line objects to render.
 * @param {string} [props.className] - Optional CSS class name.
 * @param {string|null} [props.fileColMaxWidth] - Max width constraint for file column.
 * @param {string|null} [props.sessionDir] - Host session directory for /tmp/ path resolution.
 * @param {Object<string, string>} [props.resolvedPaths] - Map of candidate -> resolved path.
 */
export default function CodeBlock({
  lines,
  className = '',
  fileColMaxWidth = null,
  sessionDir = null,
  resolvedPaths = {},
}) {
  // Calculate max widths for consistent column alignment
  // Hook must be called unconditionally (before early return)
  const { maxFileLen, maxLineNumLen } = useMemo(() => computeColumnWidths(lines), [lines])

  if (!lines || lines.length === 0) {
    return null
  }

  const hasFile = lines.some(line => line.file != null)
  const hasLineNum = lines.some(line => line.lineNum != null)
  const hasGutter = hasFile || hasLineNum

  const fileWidth = `${maxFileLen}ch`
  const style = {
    '--file-col-width': hasFile
      ? fileColMaxWidth
        ? `min(${fileWidth}, ${fileColMaxWidth})`
        : fileWidth
      : '0',
    '--linenum-col-width': `${maxLineNumLen}ch`,
  }

  return (
    <div className={['code-block', className].filter(Boolean).join(' ')} style={style}>
      {lines.map((line, i) => (
        <CodeBlockLine
          key={i}
          line={line}
          hasFile={hasFile}
          hasLineNum={hasLineNum}
          hasGutter={hasGutter}
          sessionDir={sessionDir}
          resolvedPaths={resolvedPaths}
        />
      ))}
    </div>
  )
}
