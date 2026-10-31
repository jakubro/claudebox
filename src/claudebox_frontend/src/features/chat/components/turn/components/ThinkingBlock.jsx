/** Collapsible thinking indicator with preview and relative timing. */

import { useState } from 'react'
import Markdown from '../../../../../components/Markdown'
import { useSessionWorkspace } from '../../../../../context/SessionDataContext'
import { formatBlockTiming } from '../../../../../utils/formatters'
import InjectedContext from './InjectedContext'

/**
 * @param {object} props
 * @param {object} props.event - The thinking event.
 * @param {number|null} [props.blockRelativeTime] - Offset from the turn's start, in seconds.
 * @param {Array} [props.injected] - Text the agent received after this block that no one wrote.
 */
export default function ThinkingBlock({ event, blockRelativeTime = null, injected = null }) {
  const [expanded, setExpanded] = useState(false)
  const workspaceDir = useSessionWorkspace()

  const content = event?.content || ''
  if (!content.trim()) {
    return null
  }

  const firstLine = content.split('\n')[0] || ''

  const timing = formatBlockTiming(null, blockRelativeTime)

  return (
    <div className="thinking-block">
      <div
        className="thinking-header-area"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}>
        <div className="thinking-header">
          <span className="thinking-bullet">○</span>
          <span className="thinking-label">Thinking</span>
          {timing && (
            <span
              className="block-timing"
              title={event.ts ? new Date(event.ts).toLocaleString() : undefined}>
              {timing}
            </span>
          )}
        </div>
        <div className="thinking-preview">
          <span className="thinking-corner">└</span>
          {expanded ? (
            <span className="thinking-content-inline">
              <Markdown baseDir={workspaceDir}>{content}</Markdown>
            </span>
          ) : (
            <span className="thinking-summary">{firstLine}</span>
          )}
          <InjectedContext entries={injected} />
        </div>
      </div>
    </div>
  )
}
