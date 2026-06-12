/** Default-renderer code block - syntax highlighting with auto language detection. */

import { memo } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import { detectLanguage } from '../../../../../../../../../../../utils/languageDetection'

/**
 * @param {object} props
 * @param {string} props.content - The text content to render.
 * @param {string} [props.filePath] - File path for extension-based detection.
 * @param {object} [props.renderer] - Custom renderers by detected type.
 * @param {React.ComponentType} [props.renderer.markdown] - Markdown renderer component.
 */
function DefaultCodeBlock({ content, filePath = null, renderer = null }) {
  if (!content) {
    return null
  }

  // Detect language, checking markdown only if renderer provided
  const checkMarkdown = !!renderer?.markdown
  const detected = detectLanguage(content, filePath, checkMarkdown)

  // Render markdown with custom renderer if detected and renderer provided
  if (detected === 'markdown' && renderer?.markdown) {
    const MarkdownRenderer = renderer.markdown
    return <MarkdownRenderer>{content}</MarkdownRenderer>
  }

  // Render with syntax highlighting if language detected
  if (detected) {
    return (
      <SyntaxHighlighter
        style={vs2015}
        language={detected}
        customStyle={{ margin: 0, padding: 0, background: 'transparent' }}>
        {content}
      </SyntaxHighlighter>
    )
  }

  // Fallback to plain pre
  return <pre className="codeblock-plain">{content}</pre>
}

// Memoize on (content, filePath, renderer): the streaming Turn re-renders
// every flush (~20×/sec), and react-syntax-highlighter re-runs synchronously
// per render. Tool outputs whose content has stopped changing must bail out.
// `renderer` is null at the only production call site (ToolContentRenderer's
// default fallback); if future callers pass inline `{markdown: X}` objects,
// memo bail-out will degrade - stabilize renderer identity at the call site.
export default memo(
  DefaultCodeBlock,
  (prev, next) =>
    prev.content === next.content &&
    prev.filePath === next.filePath &&
    prev.renderer === next.renderer,
)
