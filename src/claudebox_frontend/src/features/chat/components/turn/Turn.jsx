/** Conversation turn with user message, assistant response, and tool blocks. */

// audit-ignore-file: excessive-props

import { Bookmark } from 'lucide-react'
import { memo, useLayoutEffect, useMemo, useState } from 'react'
import CopyButton from '../../../../components/CopyButton.jsx'
import RelativeTime from '../../../../components/RelativeTime'
import useTurnClock from '../../../../hooks/useTurnClock'
import { createPropsComparator, sameIdSet } from '../../../../utils/comparators'
import {
  computeTimingOffsets,
  hasVisibleBlock,
  processEvents,
} from '../../../../utils/eventProcessing'
import { formatUserMessageForCopy } from '../../../../utils/formatters'
import { holdRunningTurnStart } from '../../../../utils/runningTurnStart'
import InjectedContext from './components/InjectedContext'
import NeedsUserReplies from './components/NeedsUserReplies'
import RewindSplitButton from './components/RewindSplitButton'
import TurnBlockList from './components/TurnBlockList'
import TurnMeta from './components/TurnMeta'
import TurnProgress from './components/TurnProgress'
import UserMessageContent from './components/user-message-content'
import { useFocusedMarks } from './hooks/useFocusedMarks'
import { useTurnCollapse } from './hooks/useTurnCollapse'
import { useTurnRoutingMode } from './hooks/useTurnRoutingMode'
import { TurnProvider } from './TurnContext'
import { moveHiddenInjected } from './utils/groupBlocks'
import {
  getAnswerText,
  getAssistantTextContent,
  getProgressLabel,
  getTurnPreview,
  getTurnTimeRange,
} from './utils/turnContent'

/**
 * @param {Map} props.todoDiffs - Todo changes keyed by tool_use_id
 * @param {string} [props.sessionId] - Session the blocks read files from, if not the conversation's
 * @param {boolean} props.pending - Whether this is an optimistic pending turn
 * @param {string} props.resultStatus - Result status: "error" or "success"
 * @param {Array} props.inlineReplies - Inline reply pairs (quote/from/response) for the user message
 * @param {string} [props.note] - Message box text sent alongside a form answer or a one-click reply
 * @param {string} [props.userMessageTime] - When the user message was sent; none until it is confirmed
 * @param {number} [props.sentAt] - When this tab sent the message, ahead of `userMessageTime`
 * @param {boolean} [props.sharesRunningStart] - Holds its start as the transcript's running start;
 *   never set on a side thread's turn, which runs beside the transcript's own
 * @param {number} [props.recordedDurationMs] - How long the agent recorded working on the finished turn
 * @param {Set} props.duplicateAskUserIds - Cross-turn duplicate AskUserQuestion IDs to hide
 * @param {boolean} props.isCompacting - Compaction in progress, for pending turns with no events
 *   to derive it from
 * @param {Array<{id: string, name: string}>|null} [props.waitingOn] - Background work the idle session waits on
 * @param {Function} props.onToggleBookmark - Callback to toggle bookmark: (turnId, messageType, preview)
 * @param {Set<string>} [props.bookmarkedParts] - Bookmarked part and tool-call tails of this turn
 * @param {string[]|null} [props.replies] - One-click replies the agent's ask offers, shown last
 * @param {function(string): Promise<void>} [props.onReply] - Sends a reply's label as the user's message
 */
function Turn({
  userMessage,
  attachments = null,
  inlineReplies = null,
  note = null,
  userMessageTime = null,
  sentAt = null,
  sharesRunningStart = false,
  recordedDurationMs = null,
  events,
  turnId = null,
  sessionId = null,
  todoDiffs = null,
  taskNotifications = null,
  pending = false,
  showProgress = false,
  resultStatus = null,
  interrupted = false,
  isActive = false,
  isStopping = false,
  hasNextUserMessage = false,
  nextUserMessageIsFormResponse = false,
  nextUserMessage = null,
  hasPendingMessages = false,
  defaultCollapsed = false,
  duplicateAskUserIds = null,
  onFormSubmit,
  registerPendingForm,
  onRewind,
  forking = false,
  isCompacting = false,
  isUserBookmarked = false,
  isAssistantBookmarked = false,
  bookmarkedParts = null,
  onToggleBookmark,
  waitingOn = null,
  replies = null,
  onReply,
  onEditReply,
}) {
  // Collapse state follows TurnCollapseProvider when present, falling back to local state for
  // standalone rendering (pending turns, isolated tests) with no provider mounted.
  const turnCollapse = useTurnCollapse()
  const [localCollapsed, setLocalCollapsed] = useState(defaultCollapsed)
  const hasCentralCollapse = turnCollapse != null && turnId != null
  const collapsed = hasCentralCollapse ? turnCollapse.collapsedTurnIds.has(turnId) : localCollapsed

  const toggleCollapse = () => {
    if (hasCentralCollapse) {
      turnCollapse.onToggleTurnCollapse(turnId)
    } else {
      setLocalCollapsed(prev => !prev)
    }
  }

  const routingMode = useTurnRoutingMode()
  const { isMarked } = useFocusedMarks()
  const processed = useMemo(() => processEvents(events), [events])
  const { blocks, injected } = useMemo(
    () =>
      moveHiddenInjected(
        processed.blocks,
        processed.injected,
        routingMode,
        bookmarkedParts,
        isMarked,
      ),
    [processed, routingMode, bookmarkedParts, isMarked],
  )
  const hasVisibleBlocks = useMemo(
    () => hasVisibleBlock(blocks, routingMode, bookmarkedParts, isMarked),
    [blocks, routingMode, bookmarkedParts, isMarked],
  )
  const progressLabel = useMemo(
    () => getProgressLabel(processed.blocks, routingMode, bookmarkedParts, isMarked),
    [processed, routingMode, bookmarkedParts, isMarked],
  )

  // Compaction has its own spinner via CompactionBlock, or via isCompacting prop for pending turns with no events
  const hasActiveCompaction =
    isCompacting || blocks.some(b => b.type === 'compaction' && b.isCompacting)

  // Left border: red for errors, yellow for interrupted
  const turnClass = `turn${resultStatus === 'error' ? ' turn-error' : ''}${interrupted ? ' turn-interrupted' : ''}`

  // Calculate turn duration from event timestamps
  const { startTime, endTime } = useMemo(() => getTurnTimeRange(events), [events])

  // Live ticking duration while running
  const running = isActive || showProgress
  const runningSince =
    sentAt ?? (userMessageTime ? new Date(userMessageTime).getTime() : null) ?? startTime
  const now = useTurnClock(running ? runningSince : null)

  // Layout, not passive: the footer redraws from the new start before this commit paints.
  useLayoutEffect(() => {
    if (!(sharesRunningStart && running && runningSince)) {
      return
    }
    return holdRunningTurnStart(runningSince)
  }, [sharesRunningStart, running, runningSince])

  const duration = useMemo(() => {
    if (running && runningSince) {
      return Math.max(0, Math.floor((now - runningSince) / 1000))
    }
    if (!startTime) {
      return null
    }
    if (recordedDurationMs !== null) {
      return Math.floor(recordedDurationMs / 1000)
    }
    return Math.max(0, Math.floor((endTime - startTime) / 1000))
  }, [startTime, endTime, running, runningSince, now, recordedDurationMs])

  // Precompute threshold-filtered timing offsets per block (delta >= 30s between shown offsets)
  const blockOffsets = useMemo(() => {
    const timestamps = blocks.map(block => {
      if (block.type === 'tool') {
        return block.toolResult?.ts || block.toolUse?.ts
      }
      if (block.type === 'thinking') {
        return block.event?.ts
      }
      return null
    })
    return computeTimingOffsets(timestamps, startTime)
  }, [blocks, startTime])

  // Generate preview for collapsed state
  const preview = useMemo(
    () => getTurnPreview(blocks, duration, routingMode, bookmarkedParts, isMarked),
    [blocks, duration, routingMode, bookmarkedParts, isMarked],
  )

  // Full assistant text content for copy button (without system reminders)
  const assistantTextContent = useMemo(() => getAssistantTextContent(blocks), [blocks])
  const answerText = useMemo(() => getAnswerText(blocks), [blocks])

  // Don't allow collapsing active/in-progress turns
  const awaitsQueuedMessage = hasPendingMessages && !hasNextUserMessage
  const isInProgress = isActive || isStopping || awaitsQueuedMessage
  const canCollapse = !isInProgress && hasVisibleBlocks

  const progressRow = (
    <TurnProgress
      isActive={isActive}
      isStopping={isStopping}
      showProgress={showProgress}
      hasActiveCompaction={hasActiveCompaction}
      pending={pending}
      awaitsQueuedMessage={awaitsQueuedMessage}
      duration={duration}
      endTime={endTime}
      waitingOn={waitingOn}
      label={progressLabel}
      failed={resultStatus === 'error'}>
      {startTime && canCollapse && !collapsed && answerText ? (
        <CopyButton
          text={answerText}
          className="turn-answer-copy-btn"
          title="Copy message"
          size={12}
        />
      ) : null}
    </TurnProgress>
  )

  const userActions = (
    <>
      {turnId && onRewind && (
        <RewindSplitButton turnId={turnId} onRewind={onRewind} forking={forking} />
      )}
      {turnId && onToggleBookmark && (
        <button
          type="button"
          className={`message-bookmark-btn ${isUserBookmarked ? 'active' : ''}`}
          title={isUserBookmarked ? 'Remove bookmark' : 'Bookmark this message'}
          onClick={() => onToggleBookmark(turnId, 'user', userMessage || '')}>
          <Bookmark size={12} fill={isUserBookmarked ? 'currentColor' : 'none'} />
        </button>
      )}
      <CopyButton
        text={formatUserMessageForCopy(userMessage, note)}
        className="message-copy-btn"
        title="Copy message"
        size={12}
      />
    </>
  )

  return (
    <div
      className={`turn-container ${pending ? 'pending' : ''} ${collapsed ? 'turn-collapsed' : ''}`}
      data-testid="turn-container"
      data-turn-id={turnId || undefined}>
      {(userMessage ||
        attachments?.length > 0 ||
        inlineReplies?.length > 0 ||
        injected.length > 0) && (
        <div
          className={`chat-message chat-message-user${isUserBookmarked ? ' bookmarked' : ''}${forking ? ' forking' : ''}`}
          data-testid="message-user">
          {userMessageTime ? (
            <span className="user-message-meta">
              <span className="user-message-actions">{userActions}</span>
              <span
                className="user-message-timestamp"
                data-testid="message-user-timestamp"
                title={new Date(userMessageTime).toLocaleString()}>
                <RelativeTime date={userMessageTime} />
              </span>
            </span>
          ) : null}
          <UserMessageContent
            message={userMessage}
            attachments={attachments}
            inlineReplies={inlineReplies}
            note={note}
          />
          {userMessageTime ? null : userActions}
          {injected.length > 0 && (
            <div className="injected-context-corner">
              <InjectedContext entries={injected} />
            </div>
          )}
        </div>
      )}
      {hasVisibleBlocks && (
        <div
          className={`${turnClass}${isAssistantBookmarked ? ' bookmarked' : ''}`}
          data-testid="message-assistant">
          {startTime && (
            <TurnMeta
              startTime={startTime}
              duration={duration}
              canCollapse={canCollapse}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              assistantTextContent={assistantTextContent}
              turnId={turnId}
              isBookmarked={isAssistantBookmarked}
              onToggleBookmark={onToggleBookmark}
            />
          )}
          {collapsed && preview && (
            <div className="turn-preview" onClick={toggleCollapse}>
              <span className="turn-preview-text">{preview}</span>
              <span className="turn-preview-status">{resultStatus === 'error' ? '✗' : '✓'}</span>
            </div>
          )}
          <TurnProvider
            sessionId={sessionId}
            hasNextUserMessage={hasNextUserMessage}
            nextUserMessageIsFormResponse={nextUserMessageIsFormResponse}
            nextUserMessage={nextUserMessage}
            hasPendingMessages={hasPendingMessages}
            todoDiffs={todoDiffs}
            taskNotifications={taskNotifications}
            onFormSubmit={onFormSubmit}
            registerPendingForm={registerPendingForm}
            turnStartTime={startTime}
            now={now}
            isActiveTurn={isActive}
            {...(turnId && onToggleBookmark && { turnId, bookmarkedParts, onToggleBookmark })}>
            <div className={`turn-content${collapsed ? ' turn-content-collapsed' : ''}`}>
              <TurnBlockList
                blocks={blocks}
                blockOffsets={blockOffsets}
                duplicateAskUserIds={duplicateAskUserIds}
                todoDiffs={todoDiffs}
                bookmarkedParts={bookmarkedParts}
              />
              {progressRow}
              {replies && onReply && (
                <NeedsUserReplies replies={replies} onReply={onReply} onEdit={onEditReply} />
              )}
            </div>
          </TurnProvider>
        </div>
      )}
      {!hasVisibleBlocks && (showProgress || waitingOn) && (
        <div className="turn-progress-pending" data-testid="turn-progress-pending">
          {progressRow}
        </div>
      )}
      {!hasVisibleBlocks && replies && onReply && (
        <NeedsUserReplies replies={replies} onReply={onReply} onEdit={onEditReply} />
      )}
    </div>
  )
}

// Custom comparison - skip re-render if turn content unchanged
const arePropsEqual = createPropsComparator({
  events: (a, b) =>
    a.length === b.length &&
    (a.length === 0 || a[a.length - 1].timestamp === b[b.length - 1].timestamp),
  duplicateAskUserIds: sameIdSet,
  bookmarkedParts: sameIdSet,
})

export default memo(Turn, arePropsEqual)
