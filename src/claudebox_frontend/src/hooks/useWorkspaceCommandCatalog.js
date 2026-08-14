/** Hook for fetching the workspace's filesystem-discovered slash command catalog. */

import { useContext, useEffect, useState } from 'react'
import { getCommandCatalog } from '../api/workspaces'
import { WorkspaceContext } from '../context/WorkspaceContext'

/**
 * GET /api/workspaces/{id}/commands, feeding the welcome screen slash-command picker before any
 * session attaches. Shape `{custom, mcp, builtin}` mirrors the in-session `commands` field, so
 * SessionDataContext consumers do not branch on origin. Null until resolved.
 * Best-effort: a fetch error or a missing WorkspaceProvider both resolve to null (the latter so
 * isolated component tests keep rendering).
 *
 * @returns {{custom: object[], mcp: object[], builtin: object[]} | null}
 */
export default function useWorkspaceCommandCatalog() {
  const workspaceContext = useContext(WorkspaceContext)
  const workspaceId = workspaceContext?.workspaceId ?? null
  const [catalog, setCatalog] = useState(null)

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    let cancelled = false
    getCommandCatalog()
      .then(data => {
        if (!cancelled) {
          setCatalog(data)
        }
      })
      .catch(err => {
        console.warn('useWorkspaceCommandCatalog: getCommandCatalog failed', err)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return catalog
}
