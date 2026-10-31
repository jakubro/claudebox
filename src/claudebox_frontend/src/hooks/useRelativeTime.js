/** Relative-time text ("5m ago") read from one shared clock, redrawing a reader only when its text changes. */

import { useCallback, useSyncExternalStore } from 'react'
import { formatRelativeTime } from '../utils/formatters'
import { clockNow, subscribeClock } from '../utils/relativeTimeClock'

/** `date` as relative text that keeps up with the clock; null when `date` is empty. */
export default function useRelativeTime(date) {
  const getSnapshot = useCallback(
    () => (date ? formatRelativeTime(date, clockNow()) : null),
    [date],
  )

  return useSyncExternalStore(subscribeClock, getSnapshot)
}
