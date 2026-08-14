/** Auto-clear the "creating session" overlay once SSE confirms the new session. */

import { useEffect, useRef } from 'react'
import { CREATING_OVERLAY_TIMEOUT_MS } from '../../../config/timing'

/**
 * Drive the auto-clear state machine for the creating overlay.
 *
 * Transitions: `idle -> waiting-disconnect (if connected) -> waiting-connect -> clear`. Skips to
 * `waiting-connect` directly if SSE was already disconnected at creation. Once `waiting-connect` sees a
 * reconnect, the overlay clears once no first message is buffered, or that message is now visible.
 *
 * Also installs a {@link CREATING_OVERLAY_TIMEOUT_MS} safety timeout: if SSE never reconnects, the overlay
 * clears anyway so the panel doesn't lock up.
 */
export default function useChatCreatingClear({
  isCreating,
  isConnected,
  deferredSend,
  deferredHold,
  showPendingMessagesLength,
  turnsLength,
  clearCreating,
}) {
  const phaseRef = useRef('idle')

  useEffect(() => {
    if (!isCreating) {
      phaseRef.current = 'idle'
      return
    }

    if (phaseRef.current === 'idle') {
      phaseRef.current = isConnected ? 'waiting-disconnect' : 'waiting-connect'
      return
    }

    if (phaseRef.current === 'waiting-disconnect' && !isConnected) {
      phaseRef.current = 'waiting-connect'
      return
    }

    if (phaseRef.current === 'waiting-connect' && isConnected) {
      const hasBufferedFirstMessage = deferredSend || deferredHold
      const firstMessageVisible = showPendingMessagesLength > 0 || turnsLength > 0
      if (!hasBufferedFirstMessage || firstMessageVisible) {
        clearCreating()
      }
    }
  }, [
    isCreating,
    isConnected,
    turnsLength,
    deferredSend,
    deferredHold,
    showPendingMessagesLength,
    clearCreating,
  ])

  useEffect(() => {
    if (!isCreating) {
      return
    }
    const timer = setTimeout(clearCreating, CREATING_OVERLAY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isCreating, clearCreating])
}
