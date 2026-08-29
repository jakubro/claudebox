/** Side panel listing bookmarked messages with session-scoped and global tabs. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import PanelListItem from '../../components/PanelListItem'
import { AUTOSCROLL_THRESHOLD } from '../../config/dimensions'
import { useAppActions } from '../../context/AppActionsContext'
import { useBookmarksContext } from '../../context/BookmarksContext'
import { useContainerMap } from '../../context/ContainerMapContext'
import { useEvents } from '../../context/EventsContext'
import { useSessionData } from '../../context/SessionDataContext'
import { useSessionRouting } from '../../context/SessionRoutingContext'
import { useSessionsList } from '../../context/SessionsContext'
import { useStillRunningToast } from '../../context/StillRunningToastContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { parseBookmarkId } from '../../utils/bookmarkIds'
import { formatMessagePreview, formatRelativeTime } from '../../utils/formatters'
import { openSessionInNewTab } from '../../utils/navigation'
import { computeScrollDestination, scrollAndHighlight } from '../../utils/scroll'

export default function BookmarksPanel() {
  const { sessionId, sessionName } = useSessionData()
  const { isResponding } = useEvents()
  const { showStillRunningToast } = useStillRunningToast()
  // Tab mirrors session presence ("session" active, "all" none); manual clicks lose to the next auto-switch.
  const [tab, setTab] = useState(() => (sessionId ? 'session' : 'all'))
  useEffect(() => {
    setTab(sessionId ? 'session' : 'all')
  }, [sessionId])
  const { allBookmarks, bookmarkMeta, loading, toggleBookmark, removeBookmark } =
    useBookmarksContext()
  const { navigateToSession } = useSessionRouting()
  const { workspaceId } = useWorkspace()
  const { sessions } = useSessionsList()
  const { deriveSessionStatus } = useContainerMap()
  const { markUserIntentRef, markProgrammaticScrollRef, scrollToTurnRef, focusedGroupRootRef } =
    useAppActions()

  // Brief flash on click - window.open paints with no visible feedback (openSessionInNewTab is sync).
  const [openingKey, setOpeningKey] = useState(null)

  const handleOpenInNewTab = useCallback(
    (sid, itemKey, jump) => {
      if (!(workspaceId && sid)) {
        return
      }
      setOpeningKey(itemKey)
      setTimeout(() => setOpeningKey(null), 400)
      openSessionInNewTab(workspaceId, sid, jump)
    },
    [workspaceId],
  )

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
      const sessionName = session?.name || sid.slice(0, 8)
      for (const bookmarkId of bookmarkIds) {
        const { turnId, messageType } = parseBookmarkId(bookmarkId)
        const meta = bookmarkMeta[`${sid}/${bookmarkId}`] || {}
        result.push({ sessionId: sid, sessionName, bookmarkId, turnId, messageType, ...meta })
      }
    }
    result.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    return result
  }, [allBookmarks, bookmarkMeta, sessions])

  /** Scroll to and highlight the bookmarked message element. */
  const handleSessionBookmarkClick = useCallback(
    (turnId, messageType) => {
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
    [markUserIntentRef, markProgrammaticScrollRef, scrollToTurnRef, focusedGroupRootRef],
  )

  const handleAllBookmarkClick = useCallback(
    (sid, turnId, messageType) => {
      if (sid === sessionId) {
        handleSessionBookmarkClick(turnId, messageType)
        return
      }
      if (!workspaceId) {
        return
      }
      // Snapshot prior session before navigating - the still-running toast needs it after the switch.
      const prevId = sessionId
      const prevName = sessionName
      const prevWasResponding = isResponding
      // URL carries the jump target via /turns/<role>-<id>; ChatPanel reads activeTurnId from
      // routing context and scrolls after replay.
      navigateToSession(workspaceId, sid, { turnId, messageType })
      if (prevWasResponding && prevId && prevId !== sid) {
        showStillRunningToast({
          sessionName: prevName || prevId.slice(0, 8),
          onReturn: () => navigateToSession(workspaceId, prevId),
        })
      }
    },
    [
      sessionId,
      sessionName,
      isResponding,
      workspaceId,
      navigateToSession,
      handleSessionBookmarkClick,
      showStillRunningToast,
    ],
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
      <div className="bookmarks-tabs">
        <PanelListItem
          label="This session"
          active={tab === 'session'}
          onClick={() => setTab('session')}
          count={sessionCount}
        />
        <PanelListItem
          label="All sessions"
          active={tab === 'all'}
          onClick={() => setTab('all')}
          count={allCount}
        />
      </div>
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
                    handleOpenInNewTab(sessionId, bm.bookmarkId, {
                      turnId: bm.turnId,
                      messageType: bm.messageType,
                    })
                    return
                  }
                  handleSessionBookmarkClick(bm.turnId, bm.messageType)
                }}
                onAuxClick={e => {
                  if (e.button === 1) {
                    e.preventDefault()
                    handleOpenInNewTab(sessionId, bm.bookmarkId, {
                      turnId: bm.turnId,
                      messageType: bm.messageType,
                    })
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
                      className={`container-status-dot container-status-${deriveSessionStatus(sessionId, sessions)}`}
                    />
                  )}
                  <span
                    className="bookmark-preview"
                    title={formatMessagePreview(bm.preview) || bm.turnId.slice(0, 8)}>
                    {formatMessagePreview(bm.preview) || bm.turnId.slice(0, 8)}
                  </span>
                </div>
                <div className="bookmark-meta">
                  {bm.ts && <span className="bookmark-time">{formatRelativeTime(bm.ts)}</span>}
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
                  handleOpenInNewTab(bm.sessionId, `${bm.sessionId}/${bm.bookmarkId}`, {
                    turnId: bm.turnId,
                    messageType: bm.messageType,
                  })
                  return
                }
                handleAllBookmarkClick(bm.sessionId, bm.turnId, bm.messageType)
              }}
              onAuxClick={e => {
                if (e.button === 1) {
                  e.preventDefault()
                  handleOpenInNewTab(bm.sessionId, `${bm.sessionId}/${bm.bookmarkId}`, {
                    turnId: bm.turnId,
                    messageType: bm.messageType,
                  })
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
                  className={`container-status-dot container-status-${deriveSessionStatus(bm.sessionId, sessions)}`}
                />
                <span
                  className="bookmark-preview"
                  title={formatMessagePreview(bm.preview) || bm.turnId.slice(0, 8)}>
                  {formatMessagePreview(bm.preview) || bm.turnId.slice(0, 8)}
                </span>
              </div>
              <div className="bookmark-meta">
                <span className="bookmark-session-name">{bm.sessionName}</span>
                {bm.ts && <span className="bookmark-time">{formatRelativeTime(bm.ts)}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
