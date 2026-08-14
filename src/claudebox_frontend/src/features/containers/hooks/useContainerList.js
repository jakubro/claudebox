/** Subscribe to the current workspace's containers + live container_status events. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { listContainers } from '../../../api/containers'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'
import { useWorkspace } from '../../../context/WorkspaceContext'

export default function useContainerList() {
  const [containers, setContainers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const { lastContainerEvent } = useDaemonStreamContext()
  const { workspaceId } = useWorkspace()
  const lastSeenEventRef = useRef(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setContainers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await listContainers()
      setContainers(data?.containers ?? [])
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  // Re-fetch on workspace switch.
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Daemon events use camelCase containerId; container rows use snake_case id for the same UUID - match on that.
  useEffect(() => {
    if (!lastContainerEvent) {
      return
    }
    if (lastSeenEventRef.current === lastContainerEvent) {
      return
    }
    lastSeenEventRef.current = lastContainerEvent
    const { containerId, status } = lastContainerEvent
    setContainers(prev => prev.map(c => (c.id === containerId ? { ...c, status } : c)))
  }, [lastContainerEvent])

  return { containers, error, loading, refresh }
}
