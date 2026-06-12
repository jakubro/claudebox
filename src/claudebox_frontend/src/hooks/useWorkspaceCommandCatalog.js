/** Hook for fetching the workspace's filesystem-discovered slash command catalog. */

import { useContext, useEffect, useState } from 'react'
import { getCommandCatalog } from '../api/workspaces'
import { WorkspaceContext } from '../context/WorkspaceContext'

/**
 * Fetch the workspace's filesystem-discovered slash commands so the welcome
 * screen's slash-command picker can populate before any container session
 * attaches. Result is the response from GET /api/workspaces/{id}/commands -
 * shape `{custom, mcp, builtin}` mirrors the in-session `commands` field, so
 * SessionDataContext consumers do not branch on origin. Returns null until
 * the fetch resolves.
 *
 * Best-effort: a fetch error leaves the result null and the picker degrades
 * to an empty list silently. Tolerates running outside a WorkspaceProvider
 * (returns null) so isolated component tests continue to render.
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
        // Best-effort - autocomplete falls through to empty list silently
        console.warn('useWorkspaceCommandCatalog: getCommandCatalog failed', err)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return catalog
}
