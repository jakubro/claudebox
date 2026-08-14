/** Single row in the syntax-highlighted code block - gutter + content cells. */

/**
 * @param {boolean} props.isFirst - Whether this row is the first in the block (adds top padding).
 * @param {boolean} props.isLast - Whether this row is the last in the block (adds bottom padding).
 * @param {boolean} [props.showGutter] - Whether to render the line-number gutter cell.
 */
export default function CodeBlockRow({
  lineNum,
  isFirst,
  isLast,
  maxLineNumLen,
  showGutter = true,
  content,
}) {
  return (
    <div className="code-block-row code-block-type-normal">
      {showGutter && (
        <span
          className="code-block-cell code-block-gutter"
          style={{
            paddingTop: isFirst ? '8px' : undefined,
            paddingBottom: isLast ? '8px' : undefined,
          }}>
          <span
            className="code-block-linenum"
            style={{ minWidth: `${Math.max(maxLineNumLen, 4)}ch` }}>
            {lineNum}
          </span>
        </span>
      )}
      <span
        className={`code-block-cell code-block-content${showGutter ? '' : ' code-block-no-gutter'}`}
        style={{
          paddingTop: isFirst ? '8px' : undefined,
          paddingBottom: isLast ? '8px' : undefined,
        }}>
        {content}
      </span>
    </div>
  )
}
