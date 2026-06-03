/** Stash context - user stash with server-side persistence. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getUiState, patchSessionUiState } from '../api/uiState'
import { useSessionData } from './SessionDataContext'

const StashContext = createContext(null)

/**
 * Provide stash state and actions.
 *
 * Low-frequency context - updates on stash operations only.
 * Stash is persisted to ui-state.json per-session for cross-browser sync.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function StashProvider({ children }) {
  const { sessionId } = useSessionData()

  const [stash, setStash] = useState([])
  const [pendingInsert, setPendingInsert] = useState(null)
  const sessionIdRef = useRef(null)

  // Persist stash to server
  const persistStash = useCallback(newStash => {
    if (sessionIdRef.current) {
      patchSessionUiState(sessionIdRef.current, [{ op: 'set', path: 'stash', value: newStash }])
    }
  }, [])

  // Load stash from server when sessionId changes
  useEffect(() => {
    setStash([]) // Clear immediately on session change (no persist)
    sessionIdRef.current = sessionId
    if (sessionId) {
      getUiState(sessionId)
        .then(data => setStash(data.session?.stash || []))
        .catch(() => setStash([]))
    }
  }, [sessionId])

  // Clear stash (used by reconnect) - local state only, don't persist
  const clearStash = useCallback(() => {
    setStash([])
  }, [])

  // Stash actions
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
