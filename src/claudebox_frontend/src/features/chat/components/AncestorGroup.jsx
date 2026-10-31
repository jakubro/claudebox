/** One read-only rail group - an ancestor's conversation as it stood when the rail read it. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUiState } from '../../../api/uiState'
import { CHAT_RAIL_ANCESTOR_WIDTH } from '../../../config/dimensions'
import { useOptionalBookmarks } from '../../../context/BookmarksContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { useScrollElementRef } from '../../../hooks/useVirtualListGeometry'
import { parseBookmarkId } from '../../../utils/bookmarkIds'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import useAncestorTranscript from '../hooks/useAncestorTranscript'
import { RightSlotView, resolveStoredRightSlotView } from '../utils/rightSlotViews'
import HistoricalTurnList from './HistoricalTurnList'
import AncestorQuoteHighlights from './inline-replies/AncestorQuoteHighlights'
import useInlineReplies from './inline-replies/hooks/useInlineReplies'
import { FocusedMarksContext } from './turn/FocusedMarksContext'
import { useFocusedMarksFor } from './turn/hooks/useFocusedMarks'
import { TurnRoutingContext } from './turn/TurnRoutingContext'

const NOOP = () => {}
const NOT_BOOKMARKED = () => false
const NO_PARTS = new Set()

/**
 * Renders an ancestor's transcript through the focused group's own `HistoricalTurnList`, in the
 * view its own session picked, with no registration into the app-level refs the live group owns.
 *
 * @param {object} props
 * @param {string} props.sessionId - The ancestor session to read.
 */
export default function AncestorGroup({ sessionId }) {
  const messagesRef = useRef(null)
  const [messagesEl, attachMessagesRef] = useScrollElementRef(messagesRef)
  const virtualizerRef = useRef(null)
  const { status, turns, turnResults, taskNotifications, todoDiffs, duplicateAskUserIds } =
    useAncestorTranscript(sessionId)
  const { unsent: inlineRepliesUnsent } = useInlineReplies(sessionId)
  const { navigateToSession } = useSessionRouting()
  const { workspaceId } = useWorkspace()
  const { sessions } = useSessionsList()
  const session = sessions.find(s => s.session_id === sessionId)
  const isSideThread = Boolean(session?.is_side_thread)
  const focusedMarks = useFocusedMarksFor(session?.runtime ?? null)
  const mode = useAncestorRoutingMode(sessionId)
  const bookmarkedPartsOf = useAncestorBookmarkedParts(sessionId)

  // Ordinary sent quotes, plus this session's thread-linked ones, which live in localStorage
  // only - a thread's quote never rides the wire, so it never reaches `turns`.
  const sentThreads = useMemo(() => {
    const fromTurns = turns.flatMap(t =>
      (t.inlineReplies || []).map((r, i) => ({ ...r, id: `${t.turn_id}:reply:${i}` })),
    )
    const fromThreads = inlineRepliesUnsent.filter(r => r.threadSessionId)
    return [...fromTurns, ...fromThreads]
  }, [turns, inlineRepliesUnsent])

  const handleFocusThread = useCallback(
    threadSessionId => {
      if (workspaceId) {
        navigateToSession(workspaceId, threadSessionId)
      }
    },
    [workspaceId, navigateToSession],
  )

  return (
    <div
      className="chat-rail-ancestor"
      style={{ flex: `0 0 ${CHAT_RAIL_ANCESTOR_WIDTH}px` }}
      data-testid="rail-ancestor"
      data-session-id={sessionId}>
      <div className="chat-rail-ancestor-messages chat-messages" ref={attachMessagesRef}>
        {status === 'unavailable' && (
          <p className="chat-rail-ancestor-unavailable">
            This session's conversation is unavailable.
          </p>
        )}
        {status === 'ready' && mode !== null && (
          <TurnRoutingContext.Provider value={mode}>
            <FocusedMarksContext.Provider value={focusedMarks}>
              <HistoricalTurnList
                messagesEl={messagesEl}
                virtualizerRef={virtualizerRef}
                turns={turns}
                sessionId={sessionId}
                boundaryNextUserMessage={null}
                todoDiffs={todoDiffs}
                taskNotifications={taskNotifications}
                turnResults={turnResults}
                duplicateAskUserIds={duplicateAskUserIds}
                hasPendingMessages={false}
                forkingTurnId={null}
                registerPendingForm={NOOP}
                onRewind={NOOP}
                isBookmarked={NOT_BOOKMARKED}
                bookmarkedPartsOf={bookmarkedPartsOf}
                onToggleBookmark={NOOP}
                isSideThread={isSideThread}
              />
            </FocusedMarksContext.Provider>
          </TurnRoutingContext.Provider>
        )}
      </div>
      {status === 'ready' && mode !== null && (
        <AncestorQuoteHighlights
          sessionId={sessionId}
          messagesRef={messagesRef}
          sentThreads={sentThreads}
          onFocusThread={handleFocusThread}
        />
      )}
    </div>
  )
}

function useAncestorRoutingMode(sessionId) {
  const [mode, setMode] = useState(null)
  useEffect(() => {
    let cancelled = false
    setMode(null)
    getUiState(sessionId)
      .then(data => resolveStoredRightSlotView(data.session))
      .catch(() => RightSlotView.FOCUSED)
      .then(view => {
        if (!cancelled) {
          setMode(view === RightSlotView.FOCUSED ? TurnRoutingMode.FOCUSED : TurnRoutingMode.OFF)
        }
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])
  return mode
}

function useAncestorBookmarkedParts(sessionId) {
  const ids = useOptionalBookmarks()?.allBookmarks?.[sessionId]
  return useMemo(() => {
    const parts = new Map()
    for (const id of ids ?? []) {
      const { turnId, messageType, target } = parseBookmarkId(id)
      if (target) {
        parts.set(turnId, new Set([...(parts.get(turnId) ?? []), messageType]))
      }
    }
    return turnId => parts.get(turnId) ?? NO_PARTS
  }, [ids])
}
