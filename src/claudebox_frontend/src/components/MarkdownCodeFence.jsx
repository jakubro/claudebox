/** Memoized fenced code block for Markdown - bails out on stable (code, language). */

import { memo } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import CopyButton from './CopyButton.jsx'

/**
 * Render one fenced code block with syntax highlighting and a copy button.
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

// Memoize on (code, language): react-syntax-highlighter runs synchronously
// and is the dominant per-render cost. The wrapping Markdown is also memo'd,
// but its `children` prop grows on every streaming flush (~20×/sec), so it
// never bails. Every flush re-renders every fence in the message; without
// this barrier, every finalized fence above the streaming one re-highlights
// from scratch on every flush.
export default memo(
  MarkdownCodeFence,
  (prev, next) => prev.code === next.code && prev.language === next.language,
)
