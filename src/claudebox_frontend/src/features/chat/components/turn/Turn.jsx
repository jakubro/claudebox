/** Conversation turn with user message, assistant response, and tool blocks. */

import { Bookmark } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import CopyButton from '../../../../components/CopyButton.jsx'
import { LIVE_TICK_INTERVAL_MS } from '../../../../config/timing'
import { createPropsComparator, sameIdSet } from '../../../../utils/comparators'
import { computeTimingOffsets, processEvents } from '../../../../utils/eventProcessing'
import { formatUserMessageForCopy } from '../../../../utils/formatters'
import RewindSplitButton from './components/RewindSplitButton'
import TurnBlockList from './components/TurnBlockList'
import TurnMeta from './components/TurnMeta'
import TurnProgress from './components/TurnProgress'
import UserMessageContent from './components/user-message-content'
import { useTurnCollapse } from './hooks/useTurnCollapse'
import { TurnProvider } from './TurnContext'
import { getAssistantTextContent, getTurnPreview, getTurnTimeRange } from './utils/turnContent'

/**
 * Render a conversation turn with user message, assistant blocks, and controls.
 * @param {Object} props
 * @param {string} props.userMessage - User message content
 * @param {Array} props.events - SSE events for this turn
 * @param {string} props.turnId - Turn identifier for rewind
 * @param {Map} props.todoDiffs - Todo changes keyed by tool_use_id
 * @param {Object} props.taskNotifications - Task completion notifications
 * @param {boolean} props.pending - Whether this is an optimistic pending turn
 * @param {boolean} props.showProgress - Whether to show progress indicator
 * @param {string} props.resultStatus - Turn result status (error, success)
 * @param {boolean} props.interrupted - Whether turn was interrupted
 * @param {boolean} props.isActive - Whether turn is currently active
 * @param {boolean} props.isStopping - Whether interrupt is in progress
 * @param {boolean} props.hasNextUserMessage - Whether another user message follows
 * @param {boolean} props.nextUserMessageIsFormResponse - Whether next is form response
 * @param {string} props.nextUserMessage - Content of next user message
 * @param {boolean} props.hasPendingMessages - Whether pending messages exist
 * @param {Array} props.attachments - Attachment metadata for user message
 * @param {Array} props.inlineReplies - Inline reply pairs (quote/from/response) for user message
 * @param {boolean} props.defaultCollapsed - Whether to start collapsed
 * @param {Set} props.duplicateAskUserIds - Cross-turn duplicate AskUserQuestion IDs to hide
 * @param {Function} props.onFormSubmit - Callback for form submission
 * @param {Function} props.onRewind - Callback to rewind to this turn
 * @param {boolean} props.forking - Whether a fork is in progress
 * @param {boolean} props.isCompacting - Whether compaction is in progress (for pending turns)
 * @param {boolean} props.isUserBookmarked - Whether the user message is bookmarked
 * @param {boolean} props.isAssistantBookmarked - Whether the assistant response is bookmarked
 * @param {Function} props.onToggleBookmark - Callback to toggle bookmark (turnId, messageType, preview)
 */
function Turn({
  userMessage,
  attachments = null,
  inlineReplies = null,
  events,
  turnId = null,
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
  onRewind,
  forking = false,
  isCompacting = false,
  isUserBookmarked = false,
  isAssistantBookmarked = false,
  onToggleBookmark,
}) {
  // Collapse state comes from central control (TurnCollapseProvider) when
  // present; falls back to local state for standalone rendering (pending turns
  // with no turn id, isolated tests) where no provider is mounted.
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

  const blocks = useMemo(() => processEvents(events), [events])

  // Check if compaction is in progress (has its own spinner via CompactionBlock,
  // or via isCompacting prop for pending turns that have no events)
  const hasActiveCompaction =
    isCompacting || blocks.some(b => b.type === 'compaction' && b.isCompacting)

  // Left border: red for errors, yellow for interrupted
  const turnClass = `turn${resultStatus === 'error' ? ' turn-error' : ''}${interrupted ? ' turn-interrupted' : ''}`

  // Calculate turn duration from event timestamps
  const { startTime, endTime } = useMemo(() => getTurnTimeRange(events), [events])

  // Live ticking duration when active
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!(isActive && startTime)) {
      return
    }
    const interval = setInterval(() => setNow(Date.now()), LIVE_TICK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isActive, startTime])

  const duration = useMemo(() => {
    if (!startTime) {
      return null
    }
    const end = isActive ? now : endTime
    return Math.max(0, Math.floor((end - startTime) / 1000))
  }, [startTime, endTime, isActive, now])

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
  const preview = useMemo(() => getTurnPreview(blocks, duration), [blocks, duration])

  // Full assistant text content for copy button (without system reminders)
  const assistantTextContent = useMemo(() => getAssistantTextContent(blocks), [blocks])

  // Don't allow collapsing active/in-progress turns
  const isInProgress = isActive || isStopping || (hasPendingMessages && !hasNextUserMessage)
  const canCollapse = !isInProgress && blocks.length > 0

  return (
    <div
      className={`turn-container ${pending ? 'pending' : ''} ${collapsed ? 'turn-collapsed' : ''}`}
      data-testid="turn-container"
      data-turn-id={turnId || undefined}>
      {(userMessage || attachments?.length > 0 || inlineReplies?.length > 0) && (
        <div
          className={`chat-message chat-message-user${isUserBookmarked ? ' bookmarked' : ''}${forking ? ' forking' : ''}`}
          data-testid="message-user">
          <UserMessageContent
            message={userMessage}
            attachments={attachments}
            inlineReplies={inlineReplies}
          />
          {turnId && onToggleBookmark && (
            <button
              type="button"
              className={`message-bookmark-btn ${isUserBookmarked ? 'active' : ''}`}
              title={isUserBookmarked ? 'Remove bookmark' : 'Bookmark this message'}
              onClick={() => onToggleBookmark(turnId, 'user', userMessage || '')}>
              <Bookmark size={12} fill={isUserBookmarked ? 'currentColor' : 'none'} />
            </button>
          )}
          {turnId && onRewind && (
            <RewindSplitButton turnId={turnId} onRewind={onRewind} forking={forking} />
          )}
          <CopyButton
            text={formatUserMessageForCopy(userMessage)}
            className="message-copy-btn"
            title="Copy message"
            size={12}
          />
        </div>
      )}
      {(blocks.length > 0 || showProgress) && (
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
            hasNextUserMessage={hasNextUserMessage}
            nextUserMessageIsFormResponse={nextUserMessageIsFormResponse}
            nextUserMessage={nextUserMessage}
            hasPendingMessages={hasPendingMessages}
            todoDiffs={todoDiffs}
            taskNotifications={taskNotifications}
            onFormSubmit={onFormSubmit}
            turnStartTime={startTime}
            now={now}
            isActiveTurn={isActive}>
            <div className={`turn-content${collapsed ? ' turn-content-collapsed' : ''}`}>
              <TurnBlockList
                blocks={blocks}
                blockOffsets={blockOffsets}
                duplicateAskUserIds={duplicateAskUserIds}
                todoDiffs={todoDiffs}
              />
              <TurnProgress
                isActive={isActive}
                isStopping={isStopping}
                showProgress={showProgress}
                hasActiveCompaction={hasActiveCompaction}
                pending={pending}
                hasPendingMessages={hasPendingMessages}
                hasNextUserMessage={hasNextUserMessage}
                duration={duration}
              />
            </div>
          </TurnProvider>
        </div>
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
})

export default memo(Turn, arePropsEqual)
