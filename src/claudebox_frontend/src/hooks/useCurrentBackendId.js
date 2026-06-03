/** Look up the runtime container ID (`backend_id`) for the active session's container. */

import { useEffect, useState } from 'react'
import { useDaemonStreamContext } from '../context/DaemonStreamContext'
import { useEvents } from '../context/EventsContext'
import { useWorkspace } from '../context/WorkspaceContext'

/**
 * Fetch the active session's container record from the daemon and return its
 * `backend_id` field — the runtime container ID visible in the runtime's `ps` output.
 *
 * The lookup re-runs whenever the active workspace or container changes, and
 * whenever a `container_status` SSE event names the current container (so
 * stop/start transitions reflect in the footer without manual refresh).
 *
 * @returns {string|null} The backend_id, or null when no container is attached
 *   or the lookup is still pending / failed.
 */
export default function useCurrentBackendId() {
  const { containerId } = useEvents()
  const { workspaceId } = useWorkspace()
  const { lastContainerEvent } = useDaemonStreamContext()
  const [backendId, setBackendId] = useState(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: lastContainerEvent is a refetch trigger — its value isn't read in the body, but it must remain a dep so container_status SSE events re-run the lookup.
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
