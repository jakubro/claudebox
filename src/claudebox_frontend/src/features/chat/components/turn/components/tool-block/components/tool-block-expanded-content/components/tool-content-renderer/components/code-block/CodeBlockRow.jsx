/** Single row in the syntax-highlighted code block — gutter + content cells. */

/**
 * Render one row of a syntax-highlighted code block.
 * @param {object} props
 * @param {number} props.lineNum - Absolute line number to display in the gutter.
 * @param {boolean} props.isFirst - Whether this row is the first in the block (adds top padding).
 * @param {boolean} props.isLast - Whether this row is the last in the block (adds bottom padding).
 * @param {number} props.maxLineNumLen - Maximum line-number width in characters.
 * @param {React.ReactNode} props.content - Highlighted content for this row.
 */
export default function CodeBlockRow({ lineNum, isFirst, isLast, maxLineNumLen, content }) {
  return (
    <div className="code-block-row code-block-type-normal">
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
      <span
        className="code-block-cell code-block-content"
        style={{
          paddingTop: isFirst ? '8px' : undefined,
          paddingBottom: isLast ? '8px' : undefined,
        }}>
        {content}
      </span>
    </div>
  )
}
