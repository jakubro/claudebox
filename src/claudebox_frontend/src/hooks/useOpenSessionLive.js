/** Whether the open session's container is running - stopping and stopped both read as not live. */

import { useContainerMap } from '../context/ContainerMapContext'
import { useSessionRouting } from '../context/SessionRoutingContext'
import { useSessionsList } from '../context/SessionsContext'

export default function useOpenSessionLive() {
  const { deriveSessionStatus } = useContainerMap()
  const { sessions } = useSessionsList()
  const { activeSessionId } = useSessionRouting()

  return deriveSessionStatus(activeSessionId, sessions) === 'running'
}
