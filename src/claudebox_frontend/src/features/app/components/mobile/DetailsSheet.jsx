/** Drop-down details sheet showing session metadata on mobile. */

import { useEvents } from '../../../../context/EventsContext'
import { useSessionData } from '../../../../context/SessionDataContext'
import { computeContextBar } from '../../../../utils/contextBar'
import { formatDurationClock, getWorkspaceName } from '../../../../utils/formatters'

/**
 * Render session metadata sheet below top bar.
 * @param {object} props
 * @param {Function} props.onClose - Close the sheet.
 */
export default function DetailsSheet({ onClose }) {
  const { connectionStatus } = useEvents()
  const {
    workspace,
    numTurns,
    totalCostUsd,
    totalDurationMs,
    lastContextTokens,
    contextWindow,
    model,
    effortLevel,
    permissionMode,
  } = useSessionData()

  const connected = connectionStatus === 'connected'
  const { percent: contextPercent } = computeContextBar(lastContextTokens, contextWindow)
  const workspaceName = getWorkspaceName(workspace) || '-'

  return (
    <div className="details-sheet-overlay" onClick={onClose}>
      <div className="details-sheet" onClick={e => e.stopPropagation()}>
        <div className="details-sheet-row">
          <span className={`details-sheet-dot${connected ? ' connected' : ''}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
        <div className="details-sheet-row">
          <span className="details-sheet-label">Workspace</span>
          <span>{workspaceName}</span>
        </div>
        <div className="details-sheet-row">
          <span className="details-sheet-label">Turns</span>
          <span>{numTurns}</span>
          <span className="details-sheet-sep">&middot;</span>
          <span className="details-sheet-label">Cost</span>
          <span>${totalCostUsd.toFixed(2)}</span>
        </div>
        <div className="details-sheet-row">
          <span className="details-sheet-label">Duration</span>
          <span>{formatDurationClock(totalDurationMs)}</span>
          <span className="details-sheet-sep">&middot;</span>
          <span className="details-sheet-label">Context</span>
          <span>{Math.round(contextPercent)}%</span>
        </div>
        <div className="details-sheet-row">
          <span className="details-sheet-label">Model</span>
          <span>{model || '-'}</span>
          <span className="details-sheet-sep">&middot;</span>
          <span className="details-sheet-label">Effort</span>
          <span>{effortLevel || '-'}</span>
        </div>
        <div className="details-sheet-row">
          <span className="details-sheet-label">Permission</span>
          <span>{permissionMode || '-'}</span>
        </div>
      </div>
    </div>
  )
}
