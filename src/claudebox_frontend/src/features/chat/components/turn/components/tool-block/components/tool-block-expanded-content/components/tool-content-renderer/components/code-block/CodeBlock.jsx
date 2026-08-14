/** Unified code block renderer with table layout and sticky gutter. */

import { useMemo } from 'react'
import CodeBlockLine from './CodeBlockLine'
import { computeColumnWidths } from './utils/columnWidths'

/**
 * @param {string|null} [props.fileColMaxWidth] - Max width constraint for file column.
 * @param {string|null} [props.sessionDir] - Host session directory for /tmp/ path resolution.
 * @param {Object<string, string>} [props.resolvedPaths] - Map of candidate -> resolved path.
 * @param {string|null} [props.editorTemplate] - "Open in editor" URI template for Alt+Click.
 */
export default function CodeBlock({
  lines,
  className = '',
  fileColMaxWidth = null,
  sessionDir = null,
  resolvedPaths = {},
  editorTemplate = null,
}) {
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
          editorTemplate={editorTemplate}
        />
      ))}
    </div>
  )
}
