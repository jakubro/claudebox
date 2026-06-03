/** Single line (table row) within the unified code block. */

import PathHighlighter from '../../../../../../../../../../../../components/PathHighlighter'
import InlineDiff from './components/InlineDiff'

/**
 * Render a single line with optional gutter cells and typed styling.
 *
 * Gutter is a single sticky cell containing file and linenum spans inline.
 * This ensures the entire gutter sticks together during horizontal scroll.
 * @param {object} props
 * @param {object} props.line - Line object with type, content, lineNum, and file.
 * @param {boolean} props.hasFile - Whether file column is displayed.
 * @param {boolean} props.hasLineNum - Whether line number column is displayed.
 * @param {boolean} props.hasGutter - Whether gutter (file + lineNum) is displayed.
 * @param {string|null} [props.sessionDir] - Host session directory for /tmp/ path resolution.
 * @param {Object<string, string>} [props.resolvedPaths] - Map of candidate -> resolved path.
 */
export default function CodeBlockLine({
  line,
  hasFile,
  hasLineNum,
  hasGutter,
  sessionDir = null,
  resolvedPaths = {},
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
          <PathHighlighter sessionDir={sessionDir} resolvedPaths={resolvedPaths}>
            {content ?? ''}
          </PathHighlighter>
        )}
      </span>
    </div>
  )
}
