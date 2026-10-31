/** Whether the open session waits on background work it started, and what that work is. */

import { useEvents } from '../context/EventsContext'
import useOpenSessionLive from './useOpenSessionLive'

/**
 * A session with no live container has no running work: its tasks died with the agent process.
 *
 * @returns {{isWaiting: boolean, awaitingPickup: boolean, runningBackgroundWork: Array}}
 */
export default function useBackgroundWaiting() {
  const { isResponding, awaitingPickup, runningBackgroundWork } = useEvents()
  const isLive = useOpenSessionLive()

  return {
    isWaiting: isLive && !isResponding && !awaitingPickup && runningBackgroundWork.length > 0,
    awaitingPickup: isLive && awaitingPickup,
    runningBackgroundWork,
  }
}
