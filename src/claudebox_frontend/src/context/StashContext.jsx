/** Stash context - user stash with server-side persistence. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getUiState, patchSessionUiState } from '../api/uiState'
import { useSessionData } from './SessionDataContext'

const StashContext = createContext(null)

/**
 * Provide stash state and actions.
 *
 * Low-frequency context (updates on stash operations only); persisted to ui-state.json
 * per-session for cross-browser sync.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function StashProvider({ children }) {
  const { sessionId } = useSessionData()

  const [stash, setStash] = useState([])
  const [pendingInsert, setPendingInsert] = useState(null)
  const sessionIdRef = useRef(null)

  const persistStash = useCallback(newStash => {
    if (sessionIdRef.current) {
      patchSessionUiState(sessionIdRef.current, [{ op: 'set', path: 'stash', value: newStash }])
    }
  }, [])

  // A reply applies only while its session is attached; items stashed before it arrived stay on
  // top of the stored ones and are saved with them. A failed read leaves the stash as it is.
  useEffect(() => {
    let cancelled = false
    setStash([]) // Clear immediately on session change (no persist)
    sessionIdRef.current = sessionId
    if (sessionId) {
      getUiState(sessionId)
        .then(data => {
          if (!cancelled) {
            setStash(current => mergeEarlyStash(current, data.session?.stash || [], persistStash))
          }
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [sessionId, persistStash])

  // Local state only, no persist - called on reconnect
  const clearStash = useCallback(() => {
    setStash([])
  }, [])

  const stashPush = useCallback(
    text => {
      if (!text?.trim()) {
        return
      }
      const item = { text, timestamp: Date.now() }
      setStash(prev => {
        const newStash = [item, ...prev]
        persistStash(newStash)
        return newStash
      })
    },
    [persistStash],
  )

  const stashPop = useCallback(() => {
    if (stash.length === 0) {
      return null
    }
    const [first, ...rest] = stash
    setStash(rest)
    persistStash(rest)
    setPendingInsert(first.text)
    return first.text
  }, [stash, persistStash])

  const stashCopy = useCallback(
    index => {
      if (index >= 0 && index < stash.length) {
        setPendingInsert(stash[index].text)
        return stash[index].text
      }
      return null
    },
    [stash],
  )

  const stashRemove = useCallback(
    index => {
      if (index >= 0 && index < stash.length) {
        const newStash = [...stash]
        const removed = newStash.splice(index, 1)[0]
        setStash(newStash)
        persistStash(newStash)
        setPendingInsert(removed.text)
      }
    },
    [stash, persistStash],
  )

  const clearPendingInsert = useCallback(() => {
    setPendingInsert(null)
  }, [])

  const value = useMemo(
    () => ({
      stash,
      stashPush,
      stashPop,
      stashCopy,
      stashRemove,
      pendingInsert,
      setPendingInsert,
      clearPendingInsert,
      clearStash,
    }),
    [
      stash,
      stashPush,
      stashPop,
      stashCopy,
      stashRemove,
      pendingInsert,
      clearPendingInsert,
      clearStash,
    ],
  )

  return <StashContext.Provider value={value}>{children}</StashContext.Provider>
}

/** Access stash state and actions. */
export function useStash() {
  const context = useContext(StashContext)
  if (!context) {
    throw new Error('useStash must be used within StashProvider')
  }
  return context
}

function mergeEarlyStash(current, stored, persist) {
  if (current.length === 0) {
    return stored
  }
  const isEarly = item => current.some(c => c.timestamp === item.timestamp && c.text === item.text)
  const merged = [...current, ...stored.filter(item => !isEarly(item))]
  persist(merged)
  return merged
}
