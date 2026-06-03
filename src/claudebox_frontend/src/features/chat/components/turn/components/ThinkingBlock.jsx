/** Collapsible thinking indicator with preview and relative timing. */

import { useState } from 'react'
import Markdown from '../../../../../components/Markdown'
import { formatBlockTiming } from '../../../../../utils/formatters'

/**
 * Render expandable thinking block with first-line preview.
 * @param {Object} props
 * @param {Object} props.event - Thinking event with content and ts.
 * @param {number} [props.blockRelativeTime] - Precomputed offset from turn start in seconds.
 */
export default function ThinkingBlock({ event, blockRelativeTime = null }) {
  const [expanded, setExpanded] = useState(false)

  const content = event?.content || ''
  if (!content.trim()) {
    return null
  }

  const firstLine = content.split('\n')[0] || ''

  const timing = formatBlockTiming(null, blockRelativeTime)

  return (
    <div className="thinking-block">
      {/* Clickable header area */}
      <div
        className="thinking-header-area"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}>
        <div className="thinking-header">
          <span className="thinking-bullet">○</span>
          <span className="thinking-label">Thinking</span>
          {timing && <span className="block-timing">{timing}</span>}
        </div>
        <div className="thinking-preview">
          <span className="thinking-corner">└</span>
          {expanded ? (
            <span className="thinking-content-inline">
              <Markdown>{content}</Markdown>
            </span>
          ) : (
            <span className="thinking-summary">{firstLine}</span>
          )}
        </div>
      </div>
    </div>
  )
}
