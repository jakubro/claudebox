/** Wrap the start/await/complete state machine for the interrupt API call. */

import { useCallback } from 'react'
import { interrupt } from '../api/chat'

/**
 * Caller sources the InteractionContext setters and sets `disabled` from its own guard (e.g.
 * `!canInterrupt`, `interruptStatus === 'stopping'`, or a disabled stop button).
 *
 * @param {{
 *   startInterrupt: () => void,
 *   completeInterrupt: () => void,
 *   setError: (message: string) => void,
 *   disabled?: boolean,
 * }} params
 * @returns {() => Promise<void>}
 */
export default function useInterruptHandler({
  startInterrupt,
  completeInterrupt,
  setError,
  disabled = false,
}) {
  return useCallback(async () => {
    if (disabled) {
      return
    }
    startInterrupt()
    try {
      await interrupt()
      completeInterrupt()
    } catch (_err) {
      setError('Interrupt failed')
    }
  }, [disabled, startInterrupt, completeInterrupt, setError])
}
