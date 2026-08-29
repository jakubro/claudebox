/** Look up the runtime container ID (`backend_id`) for the active session's container. */

import { useEffect, useState } from 'react'
import { getContainer } from '../api/containers'
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

    // Aborted rather than merely ignored on cleanup: this re-runs per container-status event, so
    // an abandoned request would keep its connection slot against the origin's budget.
    const controller = new AbortController()

    getContainer(containerId, { signal: controller.signal })
      .then(data => {
        setBackendId(data?.backend_id ?? null)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBackendId(null)
        }
      })

    return () => {
      controller.abort()
    }
  }, [workspaceId, containerId, lastContainerEvent])

  return backendId
}
