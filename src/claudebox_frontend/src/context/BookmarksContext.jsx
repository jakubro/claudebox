/** Shared bookmark state - single instance consumed by ChatPanel and BookmarksPanel. */

import { createContext, useContext, useMemo } from 'react'
import useBookmarks from '../hooks/useBookmarks'
import { useSessionData } from './SessionDataContext'
import { useWorkspace } from './WorkspaceContext'

const BookmarksContext = createContext(null)

/**
 * Provide a single bookmark state instance shared by all consumers.
 *
 * Ensures ChatPanel and BookmarksPanel use the same state - toggling a bookmark
 * in the chat immediately reflects in the bookmarks panel and vice versa.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function BookmarksProvider({ children }) {
  const { sessionId } = useSessionData()
  const { workspaceId } = useWorkspace()
  const {
    bookmarkedMessageIds,
    allBookmarks,
    bookmarkMeta,
    loading,
    error,
    isBookmarked,
    isTurnBookmarked,
    toggleBookmark,
    removeBookmark,
    refresh,
  } = useBookmarks(sessionId, workspaceId)

  const value = useMemo(
    () => ({
      bookmarkedMessageIds,
      allBookmarks,
      bookmarkMeta,
      loading,
      error,
      isBookmarked,
      isTurnBookmarked,
      toggleBookmark,
      removeBookmark,
      refresh,
    }),
    [
      bookmarkedMessageIds,
      allBookmarks,
      bookmarkMeta,
      loading,
      error,
      isBookmarked,
      isTurnBookmarked,
      toggleBookmark,
      removeBookmark,
      refresh,
    ],
  )

  return <BookmarksContext.Provider value={value}>{children}</BookmarksContext.Provider>
}

/**
 * Access shared bookmark state.
 * @returns {{ bookmarkedMessageIds: Set, allBookmarks: object, bookmarkMeta: object, loading: boolean, error: string|null, isBookmarked: function, isTurnBookmarked: function, toggleBookmark: function, removeBookmark: function, refresh: function }}
 */
export function useBookmarksContext() {
  const context = useContext(BookmarksContext)
  if (!context) {
    throw new Error('useBookmarksContext must be used within BookmarksProvider')
  }
  return context
}
