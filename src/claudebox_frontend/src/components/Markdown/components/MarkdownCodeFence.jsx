/** Memoized fenced code block for Markdown - bails out on stable (code, language). */

import { memo } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import CopyButton from '../../CopyButton.jsx'

const DIFF_THEME = {
  ...vs2015,
  'hljs-addition': { ...vs2015['hljs-addition'], backgroundColor: 'var(--diff-added-bg)' },
  'hljs-deletion': { ...vs2015['hljs-deletion'], backgroundColor: 'var(--diff-removed-bg)' },
}

/**
 * @param {object} props
 * @param {string} props.code - Source code string.
 * @param {string|null} props.language - Language hint from the fence info string.
 */
function MarkdownCodeFence({ code, language }) {
  const isDiff = language === 'diff'

  return (
    <div className="code-block-wrapper">
      <CopyButton text={code} className="code-copy-btn" title="Copy code" size={12} />
      <SyntaxHighlighter
        style={isDiff ? DIFF_THEME : vs2015}
        language={language}
        PreTag={isDiff ? DiffFenceBox : 'div'}>
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// Memoize on (code, language): syntax highlighting is the dominant per-render cost.
// Relies on Markdown's element-override map keeping stable identity (ARCHITECTURE.md 5.8) so siblings can bail.
export default memo(
  MarkdownCodeFence,
  (prev, next) => prev.code === next.code && prev.language === next.language,
)

function DiffFenceBox({ children, ...props }) {
  return (
    <div {...props}>
      <div className="diff-fence-lines">{children}</div>
    </div>
  )
}
