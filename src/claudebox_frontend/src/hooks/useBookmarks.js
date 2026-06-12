/** Bookmark state management with ui-state persistence and cross-tab sync. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getUiState, patchGlobalUiState } from '../api/uiState'
import {
  BOOKMARK_META_PATH,
  BOOKMARKED_TURNS_PATH,
  BOOKMARKS_CHANGE_SIGNAL_KEY as STORAGE_SIGNAL_KEY,
} from '../config/storage'

/**
 * Manage per-message bookmarks with backend persistence and cross-tab sync.
 *
 * Bookmark IDs use the format `turnId:user` or `turnId:assistant`.
 *
 * @param {string|null} sessionId - Current session ID for scoped lookups.
 * @param {string|null} workspaceId - Active workspace ID; gates the initial
 *   fetch and re-runs once workspace discovery completes (`workspaceFetch`
 *   throws "Workspace ID not set" until it is configured).
 */
export default function useBookmarks(sessionId, workspaceId) {
  const [bookmarkedMessageIds, setBookmarkedMessageIds] = useState(new Set())
  const [allBookmarks, setAllBookmarks] = useState({})
  const [bookmarkMeta, setBookmarkMeta] = useState({})
  // Sticky once first real fetch settles - prevents flips on refetch.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const firstSettledRef = useRef(false)

  /** Fetch bookmarks from ui-state backend. */
  const fetchBookmarks = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    try {
      const data = await getUiState()
      if (!mountedRef.current) {
        return
      }
      const turns = data.global?.bookmarkedTurns || {}
      const meta = data.global?.bookmarkMeta || {}

      setAllBookmarks(turns)
      setBookmarkMeta(meta)
      if (sessionId && turns[sessionId]) {
        setBookmarkedMessageIds(new Set(turns[sessionId]))
      } else {
        setBookmarkedMessageIds(new Set())
      }
      setError(null)
    } catch (err) {
      // Best-effort - bookmarks are non-critical; expose error for convention parity
      // (useSessionsList / useBoardList both surface error). Panel does not render it.
      if (mountedRef.current) {
        setError(err?.message ?? 'Failed to load bookmarks')
      }
    } finally {
      if (mountedRef.current && !firstSettledRef.current) {
        firstSettledRef.current = true
        setLoading(false)
      }
    }
  }, [sessionId, workspaceId])

  // Load bookmarks on mount and session change
  useEffect(() => {
    fetchBookmarks()
  }, [fetchBookmarks])

  // Cross-tab sync via storage event
  useEffect(() => {
    const handleStorage = e => {
      if (e.key === STORAGE_SIGNAL_KEY) {
        fetchBookmarks()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [fetchBookmarks])

  // Cleanup
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * Check if a specific message is bookmarked.
   * @param {string} turnId - Turn identifier.
   * @param {'user'|'assistant'} messageType - Which message within the turn.
   * @returns {boolean}
   */
  const isBookmarked = useCallback(
    (turnId, messageType) => bookmarkedMessageIds.has(`${turnId}:${messageType}`),
    [bookmarkedMessageIds],
  )

  /** Check if any message in a turn is bookmarked (for minimap indicators). */
  const isTurnBookmarked = useCallback(
    turnId =>
      bookmarkedMessageIds.has(`${turnId}:user`) || bookmarkedMessageIds.has(`${turnId}:assistant`),
    [bookmarkedMessageIds],
  )

  /**
   * Toggle bookmark on a specific message - add or remove.
   * @param {string} turnId - Turn identifier.
   * @param {'user'|'assistant'} messageType - Which message to bookmark.
   * @param {string} [preview=''] - Preview text for the bookmark entry.
   */
  const toggleBookmark = useCallback(
    (turnId, messageType, preview = '') => {
      if (!(sessionId && turnId && messageType)) {
        return
      }
      const bookmarkId = `${turnId}:${messageType}`
      const metaKey = `${sessionId}/${bookmarkId}`

      setBookmarkedMessageIds(prev => {
        const next = new Set(prev)
        if (next.has(bookmarkId)) {
          next.delete(bookmarkId)
          // Remove from backend
          patchGlobalUiState([
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
          // Add to backend
          const meta = { preview: preview.slice(0, 80), ts: new Date().toISOString() }
          patchGlobalUiState([
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

        // Signal other tabs
        try {
          localStorage.setItem(STORAGE_SIGNAL_KEY, Date.now().toString())
        } catch {
          // localStorage may be unavailable
        }

        return next
      })
    },
    [sessionId],
  )

  /**
   * Remove a bookmark from any session - used by the "All sessions" tab.
   * @param {string} targetSessionId - Session to remove the bookmark from.
   * @param {string} turnId - Turn identifier.
   * @param {'user'|'assistant'} messageType - Which message to unbookmark.
   */
  const removeBookmark = useCallback(
    (targetSessionId, turnId, messageType) => {
      if (!(targetSessionId && turnId && messageType)) {
        return
      }
      const bookmarkId = `${turnId}:${messageType}`
      const metaKey = `${targetSessionId}/${bookmarkId}`

      patchGlobalUiState([
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

      // If removing from the current session, also update local set
      if (targetSessionId === sessionId) {
        setBookmarkedMessageIds(prev => {
          const next = new Set(prev)
          next.delete(bookmarkId)
          return next
        })
      }

      try {
        localStorage.setItem(STORAGE_SIGNAL_KEY, Date.now().toString())
      } catch {
        // localStorage may be unavailable
      }
    },
    [sessionId],
  )

  return {
    bookmarkedMessageIds,
    allBookmarks,
    bookmarkMeta,
    loading,
    error,
    isBookmarked,
    isTurnBookmarked,
    toggleBookmark,
    removeBookmark,
    refresh: fetchBookmarks,
  }
}
