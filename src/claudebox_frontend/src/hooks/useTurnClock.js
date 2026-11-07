/** The time on a start's shared clock, changing on its whole seconds; null without a start. */

import { useCallback, useSyncExternalStore } from 'react'
import { noop } from '../utils/noop'
import { subscribeTurnClock, turnClockNow } from '../utils/turnClock'

export default function useTurnClock(start) {
  const subscribe = useCallback(
    listener => (start == null ? noop : subscribeTurnClock(start, listener)),
    [start],
  )
  const getSnapshot = useCallback(() => (start == null ? null : turnClockNow(start)), [start])

  return useSyncExternalStore(subscribe, getSnapshot)
}
