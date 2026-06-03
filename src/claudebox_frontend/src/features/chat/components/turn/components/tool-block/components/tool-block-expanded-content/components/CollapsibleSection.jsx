/** Reusable collapsible section with chevron, label, and preview. */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import CopyButton from '../../../../../../../../../components/CopyButton.jsx'
import Markdown from '../../../../../../../../../components/Markdown'

/**
 * Render a collapsible section with toggle header and expandable content.
 * @param {Object} props
 * @param {string} props.label - Section label (e.g., "Prompt", "Result").
 * @param {string} [props.content] - Text content to display as Markdown.
 * @param {boolean} [props.defaultExpanded=false] - Whether to start expanded.
 * @param {boolean} [props.showCopy=false] - Show copy button when using content prop.
 * @param {string} [props.className] - Additional CSS class for the wrapper.
 * @param {React.ReactNode} [props.children] - Custom content (alternative to content prop).
 */
export default function CollapsibleSection({
  label,
  content,
  defaultExpanded = false,
  showCopy = false,
  className = '',
  children,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // Nothing to display
  if (!(content || children)) {
    return null
  }

  const firstLine = content ? content.split('\n')[0] : ''
  const isMultiline = content ? content.includes('\n') : false

  return (
    <div className={`collapsible-section ${className}`.trim()}>
      <button type="button" className="collapsible-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="collapsible-label">{label}</span>
        {!expanded && content && (
          <span className="collapsible-preview" title={content}>
            {firstLine}
            {isMultiline && '…'}
          </span>
        )}
      </button>
      {expanded && (
        <div className="collapsible-content turn-text">
          {content ? (
            <>
              {showCopy && (
                <CopyButton
                  text={content}
                  className="collapsible-copy-btn"
                  title={`Copy ${label.toLowerCase()}`}
                  size={12}
                />
              )}
              <Markdown>{content}</Markdown>
            </>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}
