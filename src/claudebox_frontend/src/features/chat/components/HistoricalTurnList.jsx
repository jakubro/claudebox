/** Memoized list of completed (historical) turns, isolated from the active streaming turn. */

import { memo } from 'react'
import { createPropsComparator, sameIdSet } from '../../../utils/comparators'
import SettingChangeDivider from './SettingChangeDivider'
import Turn from './turn'

/**
 * Render every completed turn that precedes the active streaming turn.
 *
 * Pulled out of ChatPanel so historical turns stop reconciling on each
 * streaming flush: the active (last) turn grows per flush and is rendered by
 * ChatPanel directly, while this list's props stay referentially stable
 * between lifecycle transitions, so its memo bails and the historical subtree
 * is left untouched. `nextUserMessage` for the final historical turn comes
 * from `boundaryNextUserMessage` (the active turn's user message), since the
 * active turn is not part of this list.
 *
 * @param {Array} props.turns - Completed turns to render (active turn excluded).
 * @param {string|null} props.boundaryNextUserMessage - User message of the turn after the last one here.
 * @param {Map} props.todoDiffs - Todo changes keyed by tool_use_id.
 * @param {Object} props.taskNotifications - Task completion notifications.
 * @param {Object} props.turnResults - Result status keyed by turn_id.
 * @param {Set} props.duplicateAskUserIds - Cross-turn duplicate AskUserQuestion IDs to hide.
 * @param {boolean} props.hasPendingMessages - Whether optimistic pending messages exist.
 * @param {string|null} props.forkingTurnId - Turn currently being forked, if any.
 * @param {Function} props.onFormSubmit - Form submission callback.
 * @param {Function} props.onRewind - Rewind-to-turn callback.
 * @param {Function} props.isBookmarked - (turnId, messageType) => boolean.
 * @param {Function} props.onToggleBookmark - Toggle-bookmark callback.
 */
function HistoricalTurnList({
  turns,
  boundaryNextUserMessage,
  todoDiffs,
  taskNotifications,
  turnResults,
  duplicateAskUserIds,
  hasPendingMessages,
  forkingTurnId,
  onFormSubmit,
  onRewind,
  isBookmarked,
  onToggleBookmark,
}) {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__renderCounts__ = window.__renderCounts__ || {}
    window.__renderCounts__.historicalTurn = (window.__renderCounts__.historicalTurn || 0) + 1
  }

  return turns.map((turn, i) => {
    const nextMsg = i < turns.length - 1 ? turns[i + 1]?.userMessage : boundaryNextUserMessage
    return [
      <Turn
        key={`${turn.turn_id || 'g'}-${i}`}
        userMessage={turn.userMessage}
        attachments={turn.attachments}
        events={turn.events}
        turnId={turn.turn_id}
        todoDiffs={todoDiffs}
        taskNotifications={taskNotifications}
        resultStatus={turn.turn_id ? turnResults[turn.turn_id] : null}
        interrupted={turn.interrupted}
        hasNextUserMessage={!!nextMsg}
        nextUserMessageIsFormResponse={
          nextMsg?.includes('<response:AskUserQuestion>') ||
          nextMsg?.includes('<response:ExitPlanMode>')
        }
        nextUserMessage={nextMsg || null}
        hasPendingMessages={hasPendingMessages}
        duplicateAskUserIds={duplicateAskUserIds}
        onFormSubmit={onFormSubmit}
        onRewind={onRewind}
        forking={forkingTurnId === turn.turn_id}
        isUserBookmarked={isBookmarked(turn.turn_id, 'user')}
        isAssistantBookmarked={isBookmarked(turn.turn_id, 'assistant')}
        onToggleBookmark={onToggleBookmark}
      />,
      ...(turn.settingChanges || []).map((event, ci) => (
        <SettingChangeDivider key={`sc-${i}-${ci}`} event={event} />
      )),
    ]
  })
}

// Historical turns are complete — their objects keep stable references across
// streaming flushes (appendTurns only clones the active turn). Bail unless the
// rendered set or the shared data actually changed, so the streaming active
// turn's per-flush growth never reconciles this subtree.
export default memo(
  HistoricalTurnList,
  createPropsComparator({
    turns: (a, b) => a.length === b.length && a.every((t, i) => t === b[i]),
    duplicateAskUserIds: sameIdSet,
  }),
)
