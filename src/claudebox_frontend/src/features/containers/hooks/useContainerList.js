/** Subscribe to the current workspace's containers + live container_status events. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { listContainers } from '../../../api/containers'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'
import { useWorkspace } from '../../../context/WorkspaceContext'

/** Subscribe to per-workspace /containers + container_status SSE; returns {containers, error, loading, refresh}. */
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

  // Patch row status when a container_status event arrives. The daemon stream
  // shape is `{containerId, status}` (camelCase per useDaemonStream); the
  // aggregator response uses snake-case `id` matching containerId — they refer
  // to the same UUID.
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
