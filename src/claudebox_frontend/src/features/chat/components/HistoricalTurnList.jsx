/** Windowed list of completed (historical) turns, isolated from the active streaming turn. */

// audit-ignore-file: excessive-props

import { memo, useRef, useState } from 'react'
import { createPropsComparator, sameIdSet } from '../../../utils/comparators'
import useTurnVirtualizer from '../hooks/useTurnVirtualizer'
import { computeFoldBoundary, resolveForkParentId } from '../utils/turnFold'
import SettingChangeDivider from './SettingChangeDivider'
import ThreadFoldRow from './ThreadFoldRow'
import Turn from './turn'
import { useTurnCollapse } from './turn/hooks/useTurnCollapse'
import { useTurnRoutingMode } from './turn/hooks/useTurnRoutingMode'

const EMPTY_SET = new Set()

/**
 * Render the completed turns that currently fall inside the scroll window.
 *
 * Split from ChatPanel so historical turns skip reconciliation on each streaming flush: props stay
 * referentially stable, so the memo bails while the active turn re-renders in ChatPanel. The
 * virtualizer is owned here because it re-renders its owner every scroll frame; owning it above
 * this memo boundary would drag ChatPanel - and the live streaming turn - into each frame.
 *
 * @param {object} props.virtualizerRef - Filled with the virtualizer for ChatPanel's jump-to-turn.
 * @param {Array} props.turns - Completed turns; active turn excluded.
 * @param {string|null} props.boundaryNextUserMessage - Next user message after the last turn here.
 * @param {Set} props.duplicateAskUserIds - Cross-turn duplicate AskUserQuestion IDs to hide.
 * @param {Function} props.isBookmarked - (turnId, messageType) => boolean.
 * @param {boolean} [props.isSideThread] - This session is a promoted thread; gates the fold below.
 * @param {boolean} [props.expanded] - Controlled fold-open state; omit to manage it locally.
 * @param {Function} [props.onToggleExpanded] - Required together with `expanded`.
 */
function HistoricalTurnList({
  messagesEl,
  virtualizerRef,
  turns,
  boundaryNextUserMessage,
  todoDiffs,
  taskNotifications,
  turnResults,
  duplicateAskUserIds,
  hasPendingMessages,
  forkingTurnId,
  onFormSubmit,
  registerPendingForm,
  onRewind,
  isBookmarked,
  onToggleBookmark,
  isSideThread = false,
  expanded: controlledExpanded,
  onToggleExpanded,
}) {
  const collapse = useTurnCollapse()
  const collapsedTurnIds = collapse?.collapsedTurnIds ?? EMPTY_SET
  const listRef = useRef(null)
  // A genuine context descendant of ChatPanel's Provider (unlike ChatPanel's own useTurnHeights
  // call, which reads its ancestor's value instead) - the single delivery path this fact needs.
  const mode = useTurnRoutingMode()

  // Per group, in memory, starts folded. Uncontrolled by default; ChatPanel controls it so its
  // own useTurnHeights call prices the fold this component is showing.
  const [localExpanded, setLocalExpanded] = useState(false)
  const isControlled = controlledExpanded !== undefined
  const expanded = isControlled ? controlledExpanded : localExpanded
  const toggleExpanded = isControlled ? onToggleExpanded : () => setLocalExpanded(prev => !prev)

  const foldBoundary = computeFoldBoundary(turns, isSideThread)
  const hasFold = foldBoundary >= 0
  const folded = hasFold && !expanded
  const forkParentSessionId = hasFold ? resolveForkParentId(turns, foldBoundary) : null

  const { virtualizer, virtualItems, scrollMargin, windowed } = useTurnVirtualizer({
    messagesEl,
    listRef,
    turns,
    collapsedTurnIds,
    mode,
    foldBoundary,
    foldExpanded: expanded,
  })

  if (virtualizerRef) {
    virtualizerRef.current = virtualizer
  }

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__renderCounts__ = window.__renderCounts__ || {}
    window.__renderCounts__.historicalTurn = (window.__renderCounts__.historicalTurn || 0) + 1
  }

  const totalSize = virtualizer.getTotalSize()

  const renderTurn = i => {
    if (folded && i === 0) {
      return (
        <ThreadFoldRow
          turnCount={foldBoundary + 1}
          sourceSessionId={forkParentSessionId}
          expanded={false}
          onToggle={toggleExpanded}
        />
      )
    }
    if (folded && i > 0 && i <= foldBoundary) {
      return null
    }

    const turn = turns[i]
    if (!turn) {
      return null
    }
    const nextMsg = i < turns.length - 1 ? turns[i + 1]?.userMessage : boundaryNextUserMessage
    return (
      <>
        {hasFold && !folded && i === 0 && (
          <ThreadFoldRow
            turnCount={foldBoundary + 1}
            sourceSessionId={forkParentSessionId}
            expanded={true}
            onToggle={toggleExpanded}
          />
        )}
        <Turn
          userMessage={turn.userMessage}
          attachments={turn.attachments}
          inlineReplies={turn.inlineReplies}
          note={turn.note}
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
          registerPendingForm={registerPendingForm}
          onRewind={onRewind}
          forking={forkingTurnId === turn.turn_id}
          isUserBookmarked={isBookmarked(turn.turn_id, 'user')}
          isAssistantBookmarked={isBookmarked(turn.turn_id, 'assistant')}
          onToggleBookmark={onToggleBookmark}
        />
        {(turn.settingChanges || []).map((event, ci) => (
          <SettingChangeDivider key={`sc-${i}-${ci}`} event={event} />
        ))}
      </>
    )
  }

  // No measurable viewport: render the whole list rather than an empty window.
  if (!windowed) {
    return (
      <div className="historical-turns" ref={listRef}>
        {turns.map((turn, i) => (
          <div key={turn.turn_id ?? i} className="historical-turn-row-static" data-index={i}>
            {renderTurn(i)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="historical-turns" ref={listRef} style={{ height: totalSize }}>
      {virtualItems.map(item => (
        <div
          key={item.key}
          className="historical-turn-row"
          data-index={item.index}
          ref={virtualizer.measureElement}
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}>
          {renderTurn(item.index)}
        </div>
      ))}
    </div>
  )
}

// Turn objects keep stable references across streaming flushes (appendTurns clones only the active
// turn), so this bails unless the rendered set or shared data changed - not scroll-driven window
// changes, which originate inside this component.
export default memo(
  HistoricalTurnList,
  createPropsComparator({
    turns: (a, b) => a.length === b.length && a.every((t, i) => t === b[i]),
    duplicateAskUserIds: sameIdSet,
  }),
)
