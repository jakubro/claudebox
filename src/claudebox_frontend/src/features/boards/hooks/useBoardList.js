/** Board list hook - discover and refresh workspace boards. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listBoards } from '../../../api/boards'
import { useWorkspace } from '../../../context/WorkspaceContext'

/**
 * Manage board list discovery state. Gates the API call on workspaceId
 * presence so the apiClient's "Workspace ID not set" invariant never
 * surfaces to the user (panel renders normal loading state pre-workspace).
 *
 * @returns {object} Board list state and actions.
 */
export default function useBoardList() {
  const { workspaceId } = useWorkspace()
  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchBoards = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    setLoading(true)
    try {
      const data = await listBoards()
      setBoards(data.boards || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) {
      return
    }
    fetchBoards()
  }, [workspaceId, fetchBoards])

  return useMemo(
    () => ({ boards, loading, error, refresh: fetchBoards }),
    [boards, loading, error, fetchBoards],
  )
}
