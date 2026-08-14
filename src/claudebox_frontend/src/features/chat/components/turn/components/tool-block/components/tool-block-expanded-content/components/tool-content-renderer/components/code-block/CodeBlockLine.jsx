/** Single line (table row) within the unified code block. */

import PathHighlighter from '../../../../../../../../../../../../components/PathHighlighter'
import InlineDiff from './components/InlineDiff'

/**
 * Gutter is one sticky cell with file/linenum spans inline, so it stays together during horizontal scroll.
 * @param {string|null} [props.sessionDir] - Host session directory for /tmp/ path resolution.
 * @param {Object<string, string>} [props.resolvedPaths] - Map of candidate -> resolved path.
 * @param {string|null} [props.editorTemplate] - "Open in editor" URI template for Alt+Click.
 */
export default function CodeBlockLine({
  line,
  hasFile,
  hasLineNum,
  hasGutter,
  sessionDir = null,
  resolvedPaths = {},
  editorTemplate = null,
}) {
  const { type, content, lineNum, file, filePath, oldLine, newLine } = line

  if (type === 'separator') {
    return (
      <div className="code-block-row code-block-separator">
        {hasGutter && (
          <span className="code-block-cell code-block-gutter">
            {hasFile && <span className="code-block-file" />}
            {hasLineNum && <span className="code-block-linenum">…</span>}
          </span>
        )}
        <span className="code-block-cell code-block-content" />
      </div>
    )
  }

  return (
    <div className={`code-block-row code-block-type-${type}`}>
      {hasGutter && (
        <span className="code-block-cell code-block-gutter">
          {hasFile && (
            <span className="code-block-file" title={filePath || ''}>
              {file ?? ''}
            </span>
          )}
          {hasLineNum && <span className="code-block-linenum">{lineNum ?? ''}</span>}
        </span>
      )}
      <span
        className={`code-block-cell code-block-content${hasGutter ? '' : ' code-block-no-gutter'}`}>
        {oldLine != null && newLine != null ? (
          <InlineDiff
            oldLine={oldLine}
            newLine={newLine}
            type={type === 'diff-remove' ? 'remove' : 'add'}
          />
        ) : (
          <PathHighlighter
            sessionDir={sessionDir}
            resolvedPaths={resolvedPaths}
            editorTemplate={editorTemplate}>
            {content ?? ''}
          </PathHighlighter>
        )}
      </span>
    </div>
  )
}
