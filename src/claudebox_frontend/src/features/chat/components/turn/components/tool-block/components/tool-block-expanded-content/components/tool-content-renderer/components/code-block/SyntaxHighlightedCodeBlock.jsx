/** Syntax-highlighted code block with table-row layout and sticky gutter. */

import { memo } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import createElement from 'react-syntax-highlighter/dist/esm/create-element'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import CodeBlockRow from './CodeBlockRow'

function SyntaxHighlightedCodeBlock({
  code,
  language,
  startingLineNumber = 1,
  className = '',
  showGutter = true,
}) {
  if (!code) {
    return null
  }

  // Calculate max line number width for consistent gutter sizing
  const lineCount = code.split('\n').length
  const maxLineNum = startingLineNumber + lineCount - 1
  const maxLineNumLen = String(maxLineNum).length

  const style = showGutter
    ? { '--linenum-col-width': `${Math.max(maxLineNumLen, 4)}ch` }
    : undefined

  return (
    <div className={['code-block', className].filter(Boolean).join(' ')} style={style}>
      <SyntaxHighlighter
        style={vs2015}
        language={language}
        wrapLines
        renderer={createTableRowRenderer(startingLineNumber, maxLineNumLen, showGutter)}
        PreTag="div"
        CodeTag="div"
        customStyle={{ margin: 0, padding: 0, background: 'transparent' }}>
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// Memoized on (code, language, startingLineNumber, className, showGutter): re-highlighting is
// synchronous and expensive, and the active Turn re-renders ~20x/sec while streaming, so unchanged
// blocks must bail out or every flush re-highlights everything. showGutter is constant today, but
// a prop left out of this list is silently ignored if it ever changes.
export default memo(
  SyntaxHighlightedCodeBlock,
  (prev, next) =>
    prev.code === next.code &&
    prev.language === next.language &&
    prev.startingLineNumber === next.startingLineNumber &&
    prev.className === next.className &&
    prev.showGutter === next.showGutter,
)

/**
 * Renderer function consumed by `react-syntax-highlighter`'s `renderer` prop. Closes over
 * `startingLineNumber`, `maxLineNumLen`, and `showGutter` so each row knows its line number,
 * gutter width, and whether to render a gutter at all.
 */
function createTableRowRenderer(startingLineNumber, maxLineNumLen, showGutter) {
  return ({ rows, stylesheet, useInlineStyles }) =>
    rows.map((node, i) => {
      const lineNum = startingLineNumber + i
      const content = createElement({
        node,
        stylesheet,
        useInlineStyles,
        key: `code-content-${i}`,
      })
      return (
        <CodeBlockRow
          key={i}
          lineNum={lineNum}
          isFirst={i === 0}
          isLast={i === rows.length - 1}
          maxLineNumLen={maxLineNumLen}
          showGutter={showGutter}
          content={content}
        />
      )
    })
}
