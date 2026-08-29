/** Single board hook - fetch board state with SSE-driven updates. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBoard } from '../../../api/boards'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'
import { createDeferred } from '../../../utils/deferred'

/**
 * Manage a single board's state with SSE-driven updates.
 * @param {string|null} boardId - Board ID to load.
 * @returns {object} Board state, loading/error indicators, and refresh action.
 */
export default function useBoardData(boardId) {
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const { sessionsChanged, containerStatus } = useDaemonStreamContext()

  // Coalesces concurrent triggers (mount, SSE signals) onto one request, keyed on the board it
  // addressed - a switch mid-flight must not apply the old board's response to the new one.
  const inFlightRef = useRef(null)
  const inFlightBoardIdRef = useRef(null)
  const pendingRef = useRef(false)
  // Set by the first joiner of an in-flight request; resolves once the re-armed refetch settles,
  // so a joiner never reads the response its own trigger predates.
  const nextSettleDeferredRef = useRef(null)

  const fetchBoard = useCallback(async () => {
    if (!boardId) {
      return
    }

    if (inFlightRef.current && inFlightBoardIdRef.current === boardId) {
      pendingRef.current = true
      if (!nextSettleDeferredRef.current) {
        nextSettleDeferredRef.current = createDeferred()
      }
      return nextSettleDeferredRef.current.promise
    }

    // A wave armed against a superseded board's request would never settle - the switch has moved
    // past it, so settle it here rather than let it attach to this unrelated request.
    if (pendingRef.current) {
      pendingRef.current = false
      const orphaned = nextSettleDeferredRef.current
      nextSettleDeferredRef.current = null
      orphaned?.resolve()
    }

    const run = (async () => {
      try {
        const data = await getBoard(boardId)
        // Only the run that still owns the slot may apply its response - a board switch can
        // start a second run for a different board while this one is still in flight.
        if (inFlightRef.current === run) {
          setBoard(data)
          setError(null)
        }
      } catch (err) {
        if (inFlightRef.current === run) {
          setError(err.message)
        }
      } finally {
        if (inFlightRef.current === run) {
          setLoading(false)
          inFlightRef.current = null
          inFlightBoardIdRef.current = null

          if (pendingRef.current) {
            pendingRef.current = false
            const deferred = nextSettleDeferredRef.current
            nextSettleDeferredRef.current = null
            fetchBoard().then(deferred.resolve, deferred.reject)
          }
        }
      }
    })()

    inFlightRef.current = run
    inFlightBoardIdRef.current = boardId

    return run
  }, [boardId])

  // Initial load
  useEffect(() => {
    setLoading(true)
    fetchBoard()
  }, [fetchBoard])

  // Refresh on board_update SSE events
  useEffect(() => {
    if (sessionsChanged > 0 || containerStatus > 0) {
      fetchBoard()
    }
  }, [sessionsChanged, containerStatus, fetchBoard])

  return useMemo(
    () => ({ board, loading, error, refresh: fetchBoard }),
    [board, loading, error, fetchBoard],
  )
}
