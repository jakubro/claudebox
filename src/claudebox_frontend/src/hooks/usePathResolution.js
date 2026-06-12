/** Resolve path candidates via container API with session-scoped caching. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionId } from '../context/SessionDataContext'
import { pathResolutionManager } from '../managers/PathResolutionManager'

const EMPTY = {}

/**
 * Resolve path candidates to absolute host paths via container API, with caching.
 * @param {string[]} candidates - Unique candidate path strings to resolve.
 * @returns {Object<string, string>} Map of candidate -> resolved absolute path.
 */
export default function usePathResolution(candidates) {
  const sessionId = useSessionId()
  const [resolvedPaths, setResolvedPaths] = useState(EMPTY)
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates

  // Stable key avoids re-running effect on same candidates with different array refs
  const key = useMemo(
    () => (candidates && candidates.length > 0 ? candidates.slice().sort().join('\0') : ''),
    [candidates],
  )

  useEffect(() => {
    pathResolutionManager.setSessionId(sessionId)
  }, [sessionId])

  useEffect(() => {
    if (!key) {
      return
    }

    const currentCandidates = candidatesRef.current
    const { resolved, unresolved } = pathResolutionManager.lookup(currentCandidates)

    // Set cached hits immediately
    if (Object.keys(resolved).length > 0) {
      setResolvedPaths(resolved)
    }

    if (unresolved.length === 0) {
      return
    }

    let cancelled = false
    pathResolutionManager
      .enqueue(unresolved)
      .then(resolvedMap => {
        if (cancelled) {
          return
        }
        pathResolutionManager.store(unresolved, resolvedMap)
        setResolvedPaths(prev => ({ ...prev, ...resolvedMap }))
      })
      .catch(err => {
        // Graceful degradation - paths just won't highlight
        console.warn('usePathResolution: enqueue failed', err)
      })

    return () => {
      cancelled = true
    }
  }, [key])

  return resolvedPaths
}
