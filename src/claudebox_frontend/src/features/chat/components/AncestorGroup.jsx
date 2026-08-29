/** One read-only rail group - an ancestor's conversation as it stood when the rail read it. */

import { useCallback, useMemo, useRef } from 'react'
import { CHAT_RAIL_ANCESTOR_WIDTH } from '../../../config/dimensions'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import useAncestorTranscript from '../hooks/useAncestorTranscript'
import { useScrollElementRef } from '../hooks/useVirtualListGeometry'
import HistoricalTurnList from './HistoricalTurnList'
import AncestorQuoteHighlights from './inline-replies/AncestorQuoteHighlights'
import useInlineReplies from './inline-replies/hooks/useInlineReplies'
import { TurnRoutingContext } from './turn/TurnRoutingContext'

const NOOP = () => {}
const NOT_BOOKMARKED = () => false

/**
 * Renders an ancestor's transcript through the focused group's own `HistoricalTurnList`, with
 * `TurnRoutingContext` OFF and no registration into the app-level refs the live group owns.
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
  const isSideThread = Boolean(sessions.find(s => s.session_id === sessionId)?.is_side_thread)

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
        {status === 'ready' && (
          <TurnRoutingContext.Provider value={TurnRoutingMode.OFF}>
            <HistoricalTurnList
              messagesEl={messagesEl}
              virtualizerRef={virtualizerRef}
              turns={turns}
              boundaryNextUserMessage={null}
              todoDiffs={todoDiffs}
              taskNotifications={taskNotifications}
              turnResults={turnResults}
              duplicateAskUserIds={duplicateAskUserIds}
              hasPendingMessages={false}
              forkingTurnId={null}
              onFormSubmit={NOOP}
              registerPendingForm={NOOP}
              onRewind={NOOP}
              isBookmarked={NOT_BOOKMARKED}
              onToggleBookmark={NOOP}
              isSideThread={isSideThread}
            />
          </TurnRoutingContext.Provider>
        )}
      </div>
      {status === 'ready' && (
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
