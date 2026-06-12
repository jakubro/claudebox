/** Syntax-highlighted code block with table-row layout and sticky gutter. */

import { memo } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import createElement from 'react-syntax-highlighter/dist/esm/create-element'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import CodeBlockRow from './CodeBlockRow'

/**
 * Render syntax-highlighted code with sticky gutter using table-row layout.
 * @param {object} props
 * @param {string} props.code - Source code string to highlight.
 * @param {string} props.language - Programming language for syntax highlighting.
 * @param {number} [props.startingLineNumber=1] - First line number to display.
 * @param {string} [props.className] - Optional CSS class name.
 */
function SyntaxHighlightedCodeBlock({ code, language, startingLineNumber = 1, className = '' }) {
  if (!code) {
    return null
  }

  // Calculate max line number width for consistent gutter sizing
  const lineCount = code.split('\n').length
  const maxLineNum = startingLineNumber + lineCount - 1
  const maxLineNumLen = String(maxLineNum).length

  const style = {
    '--linenum-col-width': `${Math.max(maxLineNumLen, 4)}ch`,
  }

  return (
    <div className={['code-block', className].filter(Boolean).join(' ')} style={style}>
      <SyntaxHighlighter
        style={vs2015}
        language={language}
        wrapLines
        renderer={createTableRowRenderer(startingLineNumber, maxLineNumLen)}
        PreTag="div"
        CodeTag="div"
        customStyle={{ margin: 0, padding: 0, background: 'transparent' }}>
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// Memoize on (code, language, startingLineNumber, className): re-highlighting
// is synchronous and expensive (react-syntax-highlighter), and during a
// streaming turn the active Turn re-renders ~20×/sec. Code blocks whose
// content has stopped changing must bail out - otherwise every flush
// re-highlights every block in the response.
export default memo(
  SyntaxHighlightedCodeBlock,
  (prev, next) =>
    prev.code === next.code &&
    prev.language === next.language &&
    prev.startingLineNumber === next.startingLineNumber &&
    prev.className === next.className,
)

/**
 * Build the renderer function consumed by `react-syntax-highlighter`'s
 * `renderer` prop. Closes over `startingLineNumber` and `maxLineNumLen` so
 * each emitted row knows its absolute line number and gutter width.
 */
function createTableRowRenderer(startingLineNumber, maxLineNumLen) {
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
          content={content}
        />
      )
    })
}
