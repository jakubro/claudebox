/** Non-interactive status strip — connection dot and context usage bar. */

import { useEvents } from '../../../../context/EventsContext'
import { useSessionData } from '../../../../context/SessionDataContext'
import { getContextBarColor } from '../../../../utils/color'
import { computeContextBar } from '../../../../utils/contextBar'

/** Render thin status bar with connection indicator and context usage. */
export default function StatusStrip() {
  const { connectionStatus } = useEvents()
  const { lastContextTokens, contextWindow } = useSessionData()

  const connected = connectionStatus === 'connected'
  const { percent: contextPercent, barWidth } = computeContextBar(lastContextTokens, contextWindow)

  return (
    <div className="status-strip">
      <span
        className={`status-strip-dot${connected ? ' connected' : ''}`}
        title={connected ? 'Connected' : 'Disconnected'}
      />
      <span className="status-strip-bar">
        <span
          className="status-strip-fill"
          style={{ width: `${barWidth}%`, background: getContextBarColor(contextPercent) }}
        />
      </span>
      <span className="status-strip-pct">{Math.round(contextPercent)}%</span>
    </div>
  )
}
