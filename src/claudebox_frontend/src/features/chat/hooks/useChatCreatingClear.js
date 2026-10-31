/** Auto-clear the "creating session" overlay once SSE confirms the new session. */

import { useEffect, useRef } from 'react'
import { CREATING_OVERLAY_TIMEOUT_MS } from '../../../config/timing'

/**
 * Clear "Creating" once the new session's stream reconnects and its first message is visible, or on
 * the {@link CREATING_OVERLAY_TIMEOUT_MS} timeout - both armed only after the create request settles.
 */
export default function useChatCreatingClear({
  isCreating,
  isCreateRequestPending,
  isConnected,
  deferredSend,
  showPendingMessagesLength,
  turnsLength,
  clearCreating,
}) {
  const phaseRef = useRef('idle')

  useEffect(() => {
    if (!isCreating || isCreateRequestPending) {
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
      const hasBufferedFirstMessage = deferredSend
      const firstMessageVisible = showPendingMessagesLength > 0 || turnsLength > 0
      if (!hasBufferedFirstMessage || firstMessageVisible) {
        clearCreating()
      }
    }
  }, [
    isCreating,
    isCreateRequestPending,
    isConnected,
    turnsLength,
    deferredSend,
    showPendingMessagesLength,
    clearCreating,
  ])

  useEffect(() => {
    if (!isCreating || isCreateRequestPending) {
      return
    }
    const timer = setTimeout(clearCreating, CREATING_OVERLAY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isCreating, isCreateRequestPending, clearCreating])
}
