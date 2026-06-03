/** Tests for BookmarksContext. */

import { render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BookmarksProvider, useBookmarksContext } from './BookmarksContext'

const mockBookmarks = {
  bookmarkedMessageIds: new Set(['m1']),
  allBookmarks: [],
  bookmarkMeta: {},
  loading: false,
  error: null,
  isBookmarked: vi.fn(),
  isTurnBookmarked: vi.fn(),
  toggleBookmark: vi.fn(),
  removeBookmark: vi.fn(),
  refresh: vi.fn(),
}

const mockUseBookmarks = vi.fn(() => mockBookmarks)
vi.mock('../hooks/useBookmarks', () => ({ default: (...args) => mockUseBookmarks(...args) }))
vi.mock('./SessionDataContext', () => ({ useSessionData: () => ({ sessionId: 'test-session' }) }))
vi.mock('./WorkspaceContext', () => ({ useWorkspace: () => ({ workspaceId: 'test-ws' }) }))

function TestConsumer() {
  const ctx = useBookmarksContext()
  return <div data-testid="consumer">{ctx.bookmarkedMessageIds.has('m1') ? 'yes' : 'no'}</div>
}

describe('BookmarksContext', () => {
  it('provides context to children', () => {
    render(
      <BookmarksProvider>
        <TestConsumer />
      </BookmarksProvider>,
    )

    expect(screen.getByTestId('consumer')).toHaveTextContent('yes')
  })

  it('useBookmarksContext throws outside provider', () => {
    expect(() => renderHook(() => useBookmarksContext())).toThrow(
      'useBookmarksContext must be used within BookmarksProvider',
    )
  })

  it('passes sessionId and workspaceId to useBookmarks', () => {
    render(
      <BookmarksProvider>
        <TestConsumer />
      </BookmarksProvider>,
    )

    // useBookmarks receives the active sessionId and workspaceId
    expect(mockUseBookmarks).toHaveBeenCalledWith('test-session', 'test-ws')
  })

  it('forwards loading and error from useBookmarks through context', () => {
    mockUseBookmarks.mockReturnValueOnce({
      ...mockBookmarks,
      loading: true,
      error: 'boom',
    })

    function LoadingConsumer() {
      const ctx = useBookmarksContext()
      return (
        <div data-testid="loading-consumer">
          {String(ctx.loading)}/{ctx.error ?? 'null'}
        </div>
      )
    }

    render(
      <BookmarksProvider>
        <LoadingConsumer />
      </BookmarksProvider>,
    )

    expect(screen.getByTestId('loading-consumer')).toHaveTextContent('true/boom')
  })
})
