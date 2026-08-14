/** Memoized fenced code block for Markdown - bails out on stable (code, language). */

import { memo } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import CopyButton from '../../CopyButton.jsx'

/**
 * @param {object} props
 * @param {string} props.code - Source code string.
 * @param {string|null} props.language - Language hint from the fence info string.
 */
function MarkdownCodeFence({ code, language }) {
  return (
    <div className="code-block-wrapper">
      <CopyButton text={code} className="code-copy-btn" title="Copy code" size={12} />
      <SyntaxHighlighter style={vs2015} language={language} PreTag="div">
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
