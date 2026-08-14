/** Look up the runtime container ID (`backend_id`) for the active session's container. */

import { useEffect, useState } from 'react'
import { useDaemonStreamContext } from '../context/DaemonStreamContext'
import { useEvents } from '../context/EventsContext'
import { useWorkspace } from '../context/WorkspaceContext'

/**
 * Re-runs on workspace/container change or a `container_status` SSE event naming this container,
 * so stop/start transitions reach the footer without a refresh. Null until attached and resolved.
 */
export default function useCurrentBackendId() {
  const { containerId } = useEvents()
  const { workspaceId } = useWorkspace()
  const { lastContainerEvent } = useDaemonStreamContext()
  const [backendId, setBackendId] = useState(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: unread; kept as dep to re-run on SSE events.
  useEffect(() => {
    if (!(workspaceId && containerId)) {
      setBackendId(null)
      return
    }

    let cancelled = false
    fetch(`/api/workspaces/${workspaceId}/containers/${containerId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) {
          return
        }
        setBackendId(data?.backend_id ?? null)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setBackendId(null)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, containerId, lastContainerEvent])

  return backendId
}
