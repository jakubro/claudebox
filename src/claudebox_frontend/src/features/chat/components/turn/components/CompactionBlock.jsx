/** Display compaction progress and completion with token details. */

import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import Markdown from '../../../../../components/Markdown'
import { useSessionWorkspace } from '../../../../../context/SessionDataContext'
import { formatTokens } from '../../../../../utils/formatters'
import { parseLocalCommandOutput } from '../../../../../utils/parsers'
import InjectedContext from './InjectedContext'
import LocalCommandBlock from './LocalCommandBlock'

/**
 * @param {object} props
 * @param {object} props.event - The compaction start or boundary event.
 * @param {Array<string>} [props.summary] - The summary the compaction left, when finished.
 * @param {boolean} [props.isCompacting] - Whether compaction is still running.
 * @param {Array} [props.injected] - Text the agent received after this block that no one wrote.
 */
export default function CompactionBlock({ event, summary, isCompacting = false, injected = null }) {
  const [expanded, setExpanded] = useState(false)
  const workspaceDir = useSessionWorkspace()

  const metadata = event.message_data?.compact_metadata || {}
  const trigger = metadata.trigger || 'unknown'
  const preTokens = metadata.pre_tokens
  const hasSummary = summary?.length > 0

  // Progress state - show spinner
  if (isCompacting) {
    return (
      <div className="compaction-block">
        <div className="compaction-title">
          <span className="compaction-bullet compacting">◎</span>
          <span>Compacting conversation...</span>
        </div>
        <div className="compaction-result">
          <span className="compaction-corner">└</span>
          <span className="compaction-pending">
            <Loader2 size={12} className="spinner" />
          </span>
          <InjectedContext entries={injected} />
        </div>
      </div>
    )
  }

  // Completed state - show details
  return (
    <div className="compaction-block">
      <div
        className="compaction-header"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: hasSummary ? 'pointer' : 'default' }}>
        <div className="compaction-title">
          <span className="compaction-bullet">◎</span>
          <span>Conversation compacted</span>
        </div>
        <div className="compaction-result">
          <span className="compaction-corner">└</span>
          <span>
            {formatTokens(preTokens)} tokens, {trigger}
          </span>
          <InjectedContext entries={injected} />
        </div>
      </div>
      {expanded && hasSummary && (
        <div className="compaction-summary">
          {summary.map((content, i) => {
            const segments = parseLocalCommandOutput(content)
            return segments.map((seg, j) =>
              seg.type === 'text' ? (
                <Markdown key={`${i}-${j}`} baseDir={workspaceDir}>
                  {seg.content}
                </Markdown>
              ) : (
                <LocalCommandBlock key={`${i}-${j}`} type={seg.type} content={seg.content} />
              ),
            )
          })}
        </div>
      )}
    </div>
  )
}
