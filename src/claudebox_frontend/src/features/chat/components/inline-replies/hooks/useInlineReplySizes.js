/** Per-reply box sizes, kept in the session's UI state so any browser restores them. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getUiState, patchSessionUiState } from '../../../../../api/uiState'

/**
 * A size exists only for a box the reader has resized; every other box keeps its default.
 * @param {string|null} sessionId - The session whose replies these are; null disables it.
 */
export default function useInlineReplySizes(sessionId) {
  const [sizes, setSizes] = useState(() => new Map())
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes
  // Ids the reader resized or discarded before the stored sizes arrived - theirs win.
  const touchedRef = useRef(new Set())

  useEffect(() => {
    if (!sessionId) {
      return undefined
    }

    let cancelled = false
    getUiState(sessionId)
      .then(data => {
        const stored = data?.session?.inlineReplySizes

        if (cancelled || !stored || typeof stored !== 'object') {
          return
        }

        setSizes(prev => {
          const next = new Map(prev)

          for (const [id, size] of Object.entries(stored)) {
            if (!touchedRef.current.has(id) && size?.width > 0 && size?.height > 0) {
              next.set(id, { width: size.width, height: size.height })
            }
          }

          return next
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Live during a drag; nothing is saved until `commit`.
  const resize = useCallback((id, size) => {
    touchedRef.current.add(id)
    setSizes(prev => new Map(prev).set(id, size))
  }, [])

  const commit = useCallback(
    id => {
      const size = sizesRef.current.get(id)

      if (sessionId && size) {
        patchSessionUiState(sessionId, [{ op: 'set', path: `inlineReplySizes.${id}`, value: size }])
      }
    },
    [sessionId],
  )

  const forget = useCallback(
    id => {
      touchedRef.current.add(id)

      if (!sizesRef.current.has(id)) {
        return
      }

      setSizes(prev => {
        const next = new Map(prev)
        next.delete(id)

        return next
      })

      if (sessionId) {
        patchSessionUiState(sessionId, [{ op: 'unset', path: `inlineReplySizes.${id}` }])
      }
    },
    [sessionId],
  )

  return { sizes, resize, commit, forget }
}
