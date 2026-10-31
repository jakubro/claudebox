/** Bookmark state management with ui-state persistence and cross-tab sync. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUiState, patchGlobalUiState } from '../api/uiState'
import {
  BOOKMARK_META_PATH,
  BOOKMARKED_TURNS_PATH,
  BOOKMARKS_CHANGE_SIGNAL_KEY as STORAGE_SIGNAL_KEY,
} from '../config/storage'
import { parseBookmarkId } from '../utils/bookmarkIds'

const NO_PARTS = new Set()

/**
 * Bookmark ids are `turnId:<tail>` - `user`, `assistant`, or a part or tool-call tail (bookmarkIds.js).
 *
 * @param {string|null} workspaceId - Gates the initial fetch; re-runs once workspace discovery
 *   completes (`workspaceFetch` throws until then).
 */
export default function useBookmarks(sessionId, workspaceId) {
  const [bookmarkedMessageIds, setBookmarkedMessageIds] = useState(new Set())
  const bookmarkedIdsRef = useRef(bookmarkedMessageIds)
  const [allBookmarks, setAllBookmarks] = useState({})
  const [bookmarkMeta, setBookmarkMeta] = useState({})
  // Sticky once first real fetch settles - prevents flips on refetch.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const firstSettledRef = useRef(false)
  // Only the latest read applies: a session switch or a local write makes any earlier one stale.
  const requestSeqRef = useRef(0)

  const fetchBookmarks = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    const seq = ++requestSeqRef.current
    const isCurrent = () => mountedRef.current && seq === requestSeqRef.current
    try {
      const data = await getUiState()
      if (!isCurrent()) {
        return
      }
      const turns = data.global?.bookmarkedTurns || {}
      const meta = data.global?.bookmarkMeta || {}

      setAllBookmarks(turns)
      setBookmarkMeta(meta)
      bookmarkedIdsRef.current = new Set((sessionId && turns[sessionId]) || [])
      setBookmarkedMessageIds(bookmarkedIdsRef.current)
      setError(null)
    } catch (err) {
      // Best-effort - non-critical; error is set for parity with other list hooks, but the panel never renders it.
      if (isCurrent()) {
        setError(err?.message ?? 'Failed to load bookmarks')
      }
    } finally {
      if (mountedRef.current && !firstSettledRef.current) {
        firstSettledRef.current = true
        setLoading(false)
      }
    }
  }, [sessionId, workspaceId])

  useEffect(() => {
    fetchBookmarks()
  }, [fetchBookmarks])

  useEffect(() => {
    const handleStorage = e => {
      if (e.key === STORAGE_SIGNAL_KEY) {
        fetchBookmarks()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [fetchBookmarks])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const isBookmarked = useCallback(
    (turnId, messageType) => bookmarkedMessageIds.has(`${turnId}:${messageType}`),
    [bookmarkedMessageIds],
  )

  // Turns holding any bookmark, and each turn's part and tool-call tails.
  const { bookmarkedTurnIds, partsByTurn } = useMemo(() => {
    const turnIds = new Set()
    const parts = new Map()
    for (const id of bookmarkedMessageIds) {
      const { turnId, messageType, target } = parseBookmarkId(id)
      turnIds.add(turnId)
      if (target) {
        parts.set(turnId, new Set([...(parts.get(turnId) ?? []), messageType]))
      }
    }
    return { bookmarkedTurnIds: turnIds, partsByTurn: parts }
  }, [bookmarkedMessageIds])

  /** Check if anything in a turn is bookmarked. */
  const isTurnBookmarked = useCallback(turnId => bookmarkedTurnIds.has(turnId), [bookmarkedTurnIds])

  /** The turn's bookmarked part and tool-call tails; one shared empty set when it has none. */
  const bookmarkedPartsOf = useCallback(
    turnId => partsByTurn.get(turnId) ?? NO_PARTS,
    [partsByTurn],
  )

  // Signalled once the write lands: a tab reading on the signal must not beat the write.
  const saveAndSignal = useCallback(operations => {
    Promise.resolve(patchGlobalUiState(operations)).then(() => {
      try {
        localStorage.setItem(STORAGE_SIGNAL_KEY, Date.now().toString())
      } catch {
        // localStorage may be unavailable
      }
    })
  }, [])

  const toggleBookmark = useCallback(
    (turnId, messageType, preview = '') => {
      if (!(sessionId && turnId && messageType)) {
        return
      }
      const bookmarkId = `${turnId}:${messageType}`
      const metaKey = `${sessionId}/${bookmarkId}`
      requestSeqRef.current += 1

      const next = new Set(bookmarkedIdsRef.current)
      if (next.has(bookmarkId)) {
        next.delete(bookmarkId)
        saveAndSignal([
          { op: 'remove', path: `${BOOKMARKED_TURNS_PATH}.${sessionId}`, value: bookmarkId },
          { op: 'unset', path: `${BOOKMARK_META_PATH}.${metaKey}` },
        ])
        // Update allBookmarks optimistically
        setAllBookmarks(ab => {
          const updated = { ...ab }
          if (updated[sessionId]) {
            updated[sessionId] = updated[sessionId].filter(id => id !== bookmarkId)
            if (updated[sessionId].length === 0) {
              delete updated[sessionId]
            }
          }
          return updated
        })
        setBookmarkMeta(bm => {
          const updated = { ...bm }
          delete updated[metaKey]
          return updated
        })
      } else {
        next.add(bookmarkId)
        const meta = { preview: preview.slice(0, 80), ts: new Date().toISOString() }
        saveAndSignal([
          { op: 'add', path: `${BOOKMARKED_TURNS_PATH}.${sessionId}`, value: bookmarkId },
          { op: 'set', path: `${BOOKMARK_META_PATH}.${metaKey}`, value: meta },
        ])
        // Update allBookmarks optimistically
        setAllBookmarks(ab => {
          const updated = { ...ab }
          updated[sessionId] = [...(updated[sessionId] || []), bookmarkId]
          return updated
        })
        setBookmarkMeta(bm => ({ ...bm, [metaKey]: meta }))
      }
      bookmarkedIdsRef.current = next
      setBookmarkedMessageIds(next)
    },
    [sessionId, saveAndSignal],
  )

  /** Used by the "All sessions" tab to target a session other than the current one. */
  const removeBookmark = useCallback(
    (targetSessionId, turnId, messageType) => {
      if (!(targetSessionId && turnId && messageType)) {
        return
      }
      const bookmarkId = `${turnId}:${messageType}`
      const metaKey = `${targetSessionId}/${bookmarkId}`
      requestSeqRef.current += 1

      saveAndSignal([
        { op: 'remove', path: `${BOOKMARKED_TURNS_PATH}.${targetSessionId}`, value: bookmarkId },
        { op: 'unset', path: `${BOOKMARK_META_PATH}.${metaKey}` },
      ])

      // Optimistic local updates
      setAllBookmarks(ab => {
        const updated = { ...ab }
        if (updated[targetSessionId]) {
          updated[targetSessionId] = updated[targetSessionId].filter(id => id !== bookmarkId)
          if (updated[targetSessionId].length === 0) {
            delete updated[targetSessionId]
          }
        }
        return updated
      })
      setBookmarkMeta(bm => {
        const updated = { ...bm }
        delete updated[metaKey]
        return updated
      })

      if (targetSessionId === sessionId) {
        const next = new Set(bookmarkedIdsRef.current)
        next.delete(bookmarkId)
        bookmarkedIdsRef.current = next
        setBookmarkedMessageIds(next)
      }
    },
    [sessionId, saveAndSignal],
  )

  return {
    bookmarkedMessageIds,
    allBookmarks,
    bookmarkMeta,
    loading,
    error,
    isBookmarked,
    isTurnBookmarked,
    bookmarkedPartsOf,
    toggleBookmark,
    removeBookmark,
    refresh: fetchBookmarks,
  }
}
