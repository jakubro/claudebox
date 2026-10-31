/** Every running session's schedule events, refetched on the workspace's change signal. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reportError } from '../../../api/errorReport'
import { listSessionSchedules } from '../../../api/sessions'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { toScheduleSources } from '../utils/sessionCrons'

const NOTHING_YET = { workspaceId: null, sources: [], loaded: false, failed: false }

/**
 * Return `{ sources, loaded, failed }`, each source `{ sessionId, events, respondingSince }`.
 * A failure keeps the sources already shown; `failed` is set only while none have arrived.
 */
export default function useSessionSchedules() {
  const { workspaceId } = useWorkspace()
  const { changesByWorkspace } = useDaemonStreamContext()
  const workspaceChanges = changesByWorkspace[workspaceId] ?? 0
  const [state, setState] = useState(NOTHING_YET)

  const inFlightRef = useRef(null)
  const inFlightWorkspaceRef = useRef(null)
  const pendingRef = useRef(false)

  // Nothing awaits a fetch here, so a signal landing mid-flight only re-arms one more run.
  const fetchSchedules = useCallback(() => {
    if (!workspaceId) {
      return
    }
    if (inFlightRef.current && inFlightWorkspaceRef.current === workspaceId) {
      pendingRef.current = true
      return
    }
    pendingRef.current = false

    const run = (async () => {
      try {
        const data = await listSessionSchedules()
        if (inFlightRef.current === run) {
          setState({ workspaceId, sources: toScheduleSources(data), loaded: true, failed: false })
        }
      } catch (err) {
        if (inFlightRef.current === run) {
          reportError({ kind: 'schedules-fetch-failure', message: err?.message })
          setState(prev =>
            prev.workspaceId === workspaceId && prev.loaded
              ? prev
              : { ...NOTHING_YET, workspaceId, failed: true },
          )
        }
      } finally {
        if (inFlightRef.current === run) {
          inFlightRef.current = null
          inFlightWorkspaceRef.current = null
          if (pendingRef.current) {
            fetchSchedules()
          }
        }
      }
    })()

    inFlightRef.current = run
    inFlightWorkspaceRef.current = workspaceId
  }, [workspaceId])

  useEffect(() => {
    fetchSchedules()
  }, [fetchSchedules])

  useEffect(() => {
    if (workspaceChanges > 0) {
      fetchSchedules()
    }
  }, [workspaceChanges, fetchSchedules])

  const current = state.workspaceId === workspaceId ? state : NOTHING_YET

  return useMemo(
    () => ({ sources: current.sources, loaded: current.loaded, failed: current.failed }),
    [current],
  )
}
