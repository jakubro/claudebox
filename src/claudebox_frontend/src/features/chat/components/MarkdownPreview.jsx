/** Markdown preview with toggle to raw source view. */

import { Code } from 'lucide-react'
import { useCallback, useState } from 'react'
import CopyButton from '../../../components/CopyButton.jsx'
import Markdown from '../../../components/Markdown'
import { SyntaxHighlightedCodeBlock } from './turn/components/tool-block/components/tool-block-expanded-content/components/tool-content-renderer/components/code-block'

/**
 * Render markdown content with toggle between rendered and raw source views.
 * @param {object} props
 * @param {string} props.content - Raw markdown text.
 * @param {number} [props.startingLineNumber=1] - First line number for source view gutter.
 */
export default function MarkdownPreview({ content, startingLineNumber = 1 }) {
  const [showSource, setShowSource] = useState(false)

  const handleToggle = useCallback(() => setShowSource(s => !s), [])

  return (
    <div className="markdown-preview-container">
      <div className="markdown-preview-toolbar preview-toolbar">
        <button
          type="button"
          className={`markdown-preview-toolbar-btn preview-toolbar-btn${showSource ? ' pressed' : ''}`}
          onClick={handleToggle}
          title={showSource ? 'Show rendered' : 'Show source'}>
          <Code size={14} />
        </button>
        <CopyButton text={content} size={12} title="Copy source" />
      </div>
      {showSource ? (
        <div className="tool-details">
          <SyntaxHighlightedCodeBlock
            code={content}
            language="markdown"
            startingLineNumber={startingLineNumber}
          />
        </div>
      ) : (
        <div className="markdown-preview-content turn-text">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </div>
  )
}
