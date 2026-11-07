/** The start of the turn running in the open transcript, or null while none runs. */

import { useSyncExternalStore } from 'react'
import { runningTurnStart, subscribeRunningTurnStart } from '../utils/runningTurnStart'

export default function useRunningTurnStart() {
  return useSyncExternalStore(subscribeRunningTurnStart, runningTurnStart)
}
