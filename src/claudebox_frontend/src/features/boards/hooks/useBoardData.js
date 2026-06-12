/** Single board hook - fetch board state with SSE-driven updates. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBoard } from '../../../api/boards'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'

/**
 * Manage a single board's state with SSE-driven updates.
 * @param {string|null} boardId - Board ID to load.
 * @returns {object} Board state, loading/error indicators, and refresh action.
 */
export default function useBoardData(boardId) {
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const boardIdRef = useRef(boardId)

  const { sessionsChanged, containerStatus } = useDaemonStreamContext()

  const fetchBoard = useCallback(async () => {
    if (!boardId) {
      return
    }

    try {
      const data = await getBoard(boardId)
      setBoard(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [boardId])

  // Initial load
  useEffect(() => {
    boardIdRef.current = boardId
    setLoading(true)
    fetchBoard()
  }, [fetchBoard, boardId])

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
