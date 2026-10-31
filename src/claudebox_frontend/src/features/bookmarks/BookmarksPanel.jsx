/** Side panel listing bookmarked messages with session-scoped and global tabs. */

import { useCallback, useMemo } from 'react'
import RelativeTime from '../../components/RelativeTime'
import SessionScopeTabs from '../../components/SessionScopeTabs'
import { AUTOSCROLL_THRESHOLD } from '../../config/dimensions'
import { useAppActions } from '../../context/AppActionsContext'
import { useBookmarksContext } from '../../context/BookmarksContext'
import { useContainerMap } from '../../context/ContainerMapContext'
import { useSessionData } from '../../context/SessionDataContext'
import { useSessionsList } from '../../context/SessionsContext'
import useOpenInNewTab from '../../hooks/useOpenInNewTab'
import useSessionScopeTab from '../../hooks/useSessionScopeTab'
import useSwitchToSession from '../../hooks/useSwitchToSession'
import { bookmarkJumpOptions, parseBookmarkId, parseTail } from '../../utils/bookmarkIds'
import { formatMessagePreview } from '../../utils/formatters'
import { computeScrollDestination, scrollAndHighlight } from '../../utils/scroll'
import { displayName, isAutoNamed } from '../../utils/sessionName'
import { sessionDotState } from '../../utils/sessionRow'

export default function BookmarksPanel() {
  const { sessionId } = useSessionData()
  const [tab, setTab] = useSessionScopeTab(sessionId)
  const { allBookmarks, bookmarkMeta, loading, toggleBookmark, removeBookmark } =
    useBookmarksContext()
  const { sessions } = useSessionsList()
  const { deriveSessionStatus } = useContainerMap()
  const sessionsById = useMemo(() => new Map(sessions.map(s => [s.session_id, s])), [sessions])
  const dotState = id => sessionDotState(deriveSessionStatus(id, sessions), sessionsById.get(id))
  const {
    markUserIntentRef,
    markProgrammaticScrollRef,
    scrollToTurnRef,
    focusedGroupRootRef,
    jumpToBookmarkRef,
  } = useAppActions()

  const { openingKey, openInNewTab: handleOpenInNewTab } = useOpenInNewTab()
  const switchToSession = useSwitchToSession()

  const sessionBookmarks = useMemo(() => {
    if (!(sessionId && allBookmarks[sessionId])) {
      return []
    }
    return allBookmarks[sessionId].map(bookmarkId => {
      const { turnId, messageType } = parseBookmarkId(bookmarkId)
      return {
        bookmarkId,
        turnId,
        messageType,
        ...bookmarkMeta[`${sessionId}/${bookmarkId}`],
      }
    })
  }, [sessionId, allBookmarks, bookmarkMeta])

  const allSessionBookmarks = useMemo(() => {
    const result = []
    for (const [sid, bookmarkIds] of Object.entries(allBookmarks)) {
      if (!bookmarkIds || bookmarkIds.length === 0) {
        continue
      }
      const session = sessions.find(s => s.session_id === sid)
      const sessionName = displayName(session) || sid.slice(0, 8)
      const sessionNameIsAuto = isAutoNamed(session)
      for (const bookmarkId of bookmarkIds) {
        const { turnId, messageType } = parseBookmarkId(bookmarkId)
        const meta = bookmarkMeta[`${sid}/${bookmarkId}`] || {}
        result.push({
          sessionId: sid,
          sessionName,
          sessionNameIsAuto,
          bookmarkId,
          turnId,
          messageType,
          ...meta,
        })
      }
    }
    result.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    return result
  }, [allBookmarks, bookmarkMeta, sessions])

  /** Scroll to and highlight the bookmarked message element. */
  const handleSessionBookmarkClick = useCallback(
    (turnId, messageType) => {
      if (parseTail(messageType)) {
        jumpToBookmarkRef.current?.(turnId, messageType)
        return
      }
      // Windowed list: a far-off turn has no element yet, so hand the id to the chat panel to mount + call back.
      const bring = scrollToTurnRef.current
      if (!bring) {
        return
      }
      bring(turnId, turnContainer => {
        if (!turnContainer) {
          return
        }
        let target
        if (messageType === 'user') {
          target = turnContainer.querySelector('[data-testid="message-user"]')
        }
        if (!target) {
          target = turnContainer.querySelector('[data-testid="message-assistant"]') || turnContainer
        }
        // Scoped to the focused rail group - with an ancestor mounted alongside, an unscoped
        // query would risk resolving to its identically-testid'd scroll container instead.
        const scrollContainer = (focusedGroupRootRef.current ?? document).querySelector(
          '[data-testid="chat-messages"]',
        )
        if (scrollContainer) {
          // Mirrors ChatController's autoscroll gate: disengage synchronously if the view won't
          // end at-bottom, so the next streaming tick won't yank it back.
          // markProgrammaticScroll brackets the write so intermediate scroll events don't re-engage it.
          const destination = computeScrollDestination(scrollContainer, target, 'top')
          const willBeAtBottom =
            scrollContainer.scrollHeight - destination - scrollContainer.clientHeight <=
            AUTOSCROLL_THRESHOLD
          if (!willBeAtBottom) {
            markUserIntentRef.current?.()
          }
          markProgrammaticScrollRef.current?.()
          scrollAndHighlight(scrollContainer, target)
        } else {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
          target.classList.add('jump-highlight')
          setTimeout(() => target.classList.remove('jump-highlight'), 1500)
        }
      })
    },
    [
      markUserIntentRef,
      markProgrammaticScrollRef,
      scrollToTurnRef,
      focusedGroupRootRef,
      jumpToBookmarkRef,
    ],
  )

  const handleAllBookmarkClick = useCallback(
    (sid, turnId, messageType) => {
      if (sid === sessionId) {
        handleSessionBookmarkClick(turnId, messageType)
        return
      }
      // URL carries the jump target via /turns/<role>-<id>; ChatPanel reads activeTurnId from
      // routing context and scrolls after replay.
      switchToSession(sid, bookmarkJumpOptions(turnId, messageType))
    },
    [sessionId, handleSessionBookmarkClick, switchToSession],
  )

  const handleRemoveSessionBookmark = useCallback(
    (e, turnId, messageType) => {
      e.stopPropagation()
      toggleBookmark(turnId, messageType)
    },
    [toggleBookmark],
  )

  const handleRemoveAllBookmark = useCallback(
    (e, targetSessionId, turnId, messageType) => {
      e.stopPropagation()
      removeBookmark(targetSessionId, turnId, messageType)
    },
    [removeBookmark],
  )

  const sessionCount = sessionBookmarks.length
  const allCount = allSessionBookmarks.length

  if (loading && !sessionCount && !allCount) {
    return (
      <div className="bookmarks-panel bookmarks-loading" data-testid="panel-bookmarks">
        Loading...
      </div>
    )
  }

  return (
    <div className="panel-content bookmarks-panel" data-testid="panel-bookmarks">
      <SessionScopeTabs
        tab={tab}
        onTabChange={setTab}
        sessionCount={sessionCount}
        allCount={allCount}
      />
      <div className="bookmarks-list">
        {tab === 'session' ? (
          sessionCount === 0 ? (
            <p className="bookmarks-empty">No bookmarks</p>
          ) : (
            sessionBookmarks.map(bm => (
              <div
                key={bm.bookmarkId}
                className={`bookmark-item${openingKey === bm.bookmarkId ? ' bookmark-item-opening' : ''}`}
                onClick={e => {
                  if (e.altKey) {
                    handleOpenInNewTab(
                      sessionId,
                      bm.bookmarkId,
                      bookmarkJumpOptions(bm.turnId, bm.messageType),
                    )
                    return
                  }
                  handleSessionBookmarkClick(bm.turnId, bm.messageType)
                }}
                onAuxClick={e => {
                  if (e.button === 1) {
                    e.preventDefault()
                    handleOpenInNewTab(
                      sessionId,
                      bm.bookmarkId,
                      bookmarkJumpOptions(bm.turnId, bm.messageType),
                    )
                  }
                }}
                data-testid="bookmark-item">
                <button
                  type="button"
                  className="bookmark-remove"
                  title="Remove bookmark"
                  onClick={e => handleRemoveSessionBookmark(e, bm.turnId, bm.messageType)}>
                  ×
                </button>
                <div className="bookmark-row">
                  {sessionId && (
                    <span
                      className={`container-status-dot container-status-${dotState(sessionId)}`}
                    />
                  )}
                  <span
                    className="bookmark-preview"
                    title={formatMessagePreview(bm.preview) || bm.turnId.slice(0, 8)}>
                    {formatMessagePreview(bm.preview) || bm.turnId.slice(0, 8)}
                  </span>
                </div>
                <div className="bookmark-meta">
                  {bm.ts && (
                    <span className="bookmark-time">
                      <RelativeTime date={bm.ts} />
                    </span>
                  )}
                </div>
              </div>
            ))
          )
        ) : allCount === 0 ? (
          <p className="bookmarks-empty">No bookmarks</p>
        ) : (
          allSessionBookmarks.map(bm => (
            <div
              key={`${bm.sessionId}/${bm.bookmarkId}`}
              className={`bookmark-item ${bm.sessionId === sessionId ? 'current-session' : ''} ${
                openingKey === `${bm.sessionId}/${bm.bookmarkId}` ? 'bookmark-item-opening' : ''
              }`}
              onClick={e => {
                if (e.altKey) {
                  handleOpenInNewTab(
                    bm.sessionId,
                    `${bm.sessionId}/${bm.bookmarkId}`,
                    bookmarkJumpOptions(bm.turnId, bm.messageType),
                  )
                  return
                }
                handleAllBookmarkClick(bm.sessionId, bm.turnId, bm.messageType)
              }}
              onAuxClick={e => {
                if (e.button === 1) {
                  e.preventDefault()
                  handleOpenInNewTab(
                    bm.sessionId,
                    `${bm.sessionId}/${bm.bookmarkId}`,
                    bookmarkJumpOptions(bm.turnId, bm.messageType),
                  )
                }
              }}
              data-testid="bookmark-item">
              <button
                type="button"
                className="bookmark-remove"
                title="Remove bookmark"
                onClick={e => handleRemoveAllBookmark(e, bm.sessionId, bm.turnId, bm.messageType)}>
                ×
              </button>
              <div className="bookmark-row">
                <span
                  className={`container-status-dot container-status-${dotState(bm.sessionId)}`}
                />
                <span
                  className="bookmark-preview"
                  title={formatMessagePreview(bm.preview) || bm.turnId.slice(0, 8)}>
                  {formatMessagePreview(bm.preview) || bm.turnId.slice(0, 8)}
                </span>
              </div>
              <div className="bookmark-meta">
                <span
                  className={`bookmark-session-name${bm.sessionNameIsAuto ? ' auto-named' : ''}`}>
                  {bm.sessionName}
                </span>
                {bm.ts && (
                  <span className="bookmark-time">
                    <RelativeTime date={bm.ts} />
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
