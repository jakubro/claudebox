/** Whether the active turn is currently responding, and the work panel's own live-ticking clock. */

import { useEffect, useState } from 'react'
import { LIVE_TICK_INTERVAL_MS } from '../../../config/timing'

/**
 * Extracted to keep ChatPanel below the cognitive-complexity gate.
 *
 * One `isActiveTurnResponding` serves both the active turn's props and the panel's per-entry flag,
 * so they cannot desync; `workPanelNow` ticks only while the work view shows a responding turn.
 */
export function useWorkPanelLiveState({
  isResponding,
  isAwaitingResponse,
  interruptStatus,
  pendingMessageCount,
  showWorkView,
}) {
  const isActiveTurnResponding =
    (isResponding || isAwaitingResponse) && !interruptStatus && pendingMessageCount === 0

  const [workPanelNow, setWorkPanelNow] = useState(() => Date.now())
  useEffect(() => {
    if (!(showWorkView && isActiveTurnResponding)) {
      return undefined
    }
    const interval = setInterval(() => setWorkPanelNow(Date.now()), LIVE_TICK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [showWorkView, isActiveTurnResponding])

  return { isActiveTurnResponding, workPanelNow }
}
