/** Wrap the start/await/complete state machine for the interrupt API call. */

import { useCallback } from 'react'
import { interrupt } from '../api/chat'

/**
 * Build a callback that drives the interrupt lifecycle and surfaces failures.
 *
 * The caller is responsible for sourcing the InteractionContext setters and
 * setting `disabled` based on the appropriate guard (e.g. `!canInterrupt`,
 * `interruptStatus === 'stopping'`, or "stop button is disabled").
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
