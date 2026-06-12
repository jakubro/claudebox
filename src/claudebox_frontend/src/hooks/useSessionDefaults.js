/** Hook for fetching the workspace's session defaults - model / permission / effort / workspace path. */

import { useContext, useEffect, useState } from 'react'
import { getSessionDefaults } from '../api/workspaces'
import { WorkspaceContext } from '../context/WorkspaceContext'

/**
 * Fetch the model / permission mode / effort level a new session in the
 * active workspace would inherit. Result is the response from
 * GET /api/workspaces/{id}/session-defaults, or null until the fetch resolves.
 *
 * Used by the footer to populate picker display values on the welcome screen
 * (before any session attaches), so the user sees what a `+`-clicked session
 * will actually use rather than `-` placeholders.
 *
 * Best-effort: a fetch error leaves the result null and the pickers fall
 * through to their existing `-` rendering. Also tolerates running outside
 * a WorkspaceProvider (returns null) so existing isolated component tests
 * that don't mount the workspace tree continue to render the footer.
 *
 * @returns {{workspace: string, model: string, permission_mode: string, effort_level: string} | null}
 */
export default function useSessionDefaults() {
  const workspaceContext = useContext(WorkspaceContext)
  const workspaceId = workspaceContext?.workspaceId ?? null
  const [defaults, setDefaults] = useState(null)

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    let cancelled = false
    getSessionDefaults()
      .then(data => {
        if (!cancelled) {
          setDefaults(data)
        }
      })
      .catch(err => {
        // Best-effort - pickers fall through to their existing `-` display
        console.warn('useSessionDefaults: getSessionDefaults failed', err)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return defaults
}
