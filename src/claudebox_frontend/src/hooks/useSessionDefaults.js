/** Hook for fetching the workspace's session defaults - model / permission / effort / workspace path. */

import { useContext, useEffect, useState } from 'react'
import { getSessionDefaults } from '../api/workspaces'
import { SESSION_DEFAULTS_CACHE_TTL_MS } from '../config/timing'
import { WorkspaceContext } from '../context/WorkspaceContext'

/**
 * GET /api/workspaces/{id}/session-defaults, cached per workspace (SESSION_DEFAULTS_CACHE_TTL_MS)
 * so concurrent mounts share one fetch; result is null until resolved. Feeds the footer picker
 * on the welcome screen (pre-attach) so a `+`-click shows real values instead of `-` placeholders.
 * Best-effort: fetch errors and a missing WorkspaceProvider both resolve to null, the latter so
 * isolated component tests keep rendering the footer.
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
    _resolveSessionDefaults(workspaceId)
      .then(data => {
        if (!cancelled) {
          setDefaults(data)
        }
      })
      .catch(err => {
        console.warn('useSessionDefaults: getSessionDefaults failed', err)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return defaults
}

// Attached, not exported separately, so knip doesn't flag a test-only binding as unused.
useSessionDefaults.resetCache = function resetSessionDefaultsCache() {
  _cache = new Map()
  _inFlight = new Map()
}

/** workspaceId -> { value, fetchedAt } */
let _cache = new Map()
/** workspaceId -> in-flight fetch promise, so concurrent mounts share one request. */
let _inFlight = new Map()

/** Coalesces callers onto one request; refetches once stale. Rejections aren't cached, so callers retry. */
function _resolveSessionDefaults(workspaceId) {
  const cached = _cache.get(workspaceId)
  if (cached && Date.now() - cached.fetchedAt < SESSION_DEFAULTS_CACHE_TTL_MS) {
    return Promise.resolve(cached.value)
  }

  const pending = _inFlight.get(workspaceId)
  if (pending) {
    return pending
  }

  const promise = getSessionDefaults()
    .then(value => {
      _cache.set(workspaceId, { value, fetchedAt: Date.now() })
      return value
    })
    .finally(() => {
      _inFlight.delete(workspaceId)
    })

  _inFlight.set(workspaceId, promise)
  return promise
}
