/** Conversation turn with user message, assistant response, and tool blocks. */

// audit-ignore-file: excessive-props

import { Bookmark } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import CopyButton from '../../../../components/CopyButton.jsx'
import { LIVE_TICK_INTERVAL_MS } from '../../../../config/timing'
import { createPropsComparator, sameIdSet } from '../../../../utils/comparators'
import {
  computeTimingOffsets,
  hasVisibleBlock,
  processEvents,
} from '../../../../utils/eventProcessing'
import { formatUserMessageForCopy } from '../../../../utils/formatters'
import RewindSplitButton from './components/RewindSplitButton'
import TurnBlockList from './components/TurnBlockList'
import TurnMeta from './components/TurnMeta'
import TurnProgress from './components/TurnProgress'
import UserMessageContent from './components/user-message-content'
import { useHideShellCalls } from './hooks/useHideShellCalls'
import { useTurnCollapse } from './hooks/useTurnCollapse'
import { TurnProvider } from './TurnContext'
import { getAssistantTextContent, getTurnPreview, getTurnTimeRange } from './utils/turnContent'

/**
 * @param {Map} props.todoDiffs - Todo changes keyed by tool_use_id
 * @param {boolean} props.pending - Whether this is an optimistic pending turn
 * @param {string} props.resultStatus - Result status: "error" or "success"
 * @param {Array} props.inlineReplies - Inline reply pairs (quote/from/response) for the user message
 * @param {string} [props.note] - Message typed alongside an AskUserQuestion/ExitPlanMode answer
 * @param {Set} props.duplicateAskUserIds - Cross-turn duplicate AskUserQuestion IDs to hide
 * @param {boolean} props.isCompacting - Compaction in progress, for pending turns with no events
 *   to derive it from
 * @param {Function} props.onToggleBookmark - Callback to toggle bookmark: (turnId, messageType, preview)
 */
function Turn({
  userMessage,
  attachments = null,
  inlineReplies = null,
  note = null,
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
  registerPendingForm,
  onRewind,
  forking = false,
  isCompacting = false,
  isUserBookmarked = false,
  isAssistantBookmarked = false,
  onToggleBookmark,
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

  const hideShellCalls = useHideShellCalls()
  const blocks = useMemo(() => processEvents(events), [events])
  const hasVisibleBlocks = useMemo(
    () => hasVisibleBlock(blocks, hideShellCalls),
    [blocks, hideShellCalls],
  )

  // Compaction has its own spinner via CompactionBlock, or via isCompacting prop for pending turns with no events
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
  const preview = useMemo(
    () => getTurnPreview(blocks, duration, hideShellCalls),
    [blocks, duration, hideShellCalls],
  )

  // Full assistant text content for copy button (without system reminders)
  const assistantTextContent = useMemo(() => getAssistantTextContent(blocks), [blocks])

  // Don't allow collapsing active/in-progress turns
  const isInProgress = isActive || isStopping || (hasPendingMessages && !hasNextUserMessage)
  const canCollapse = !isInProgress && hasVisibleBlocks

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
            note={note}
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
            text={formatUserMessageForCopy(userMessage, note)}
            className="message-copy-btn"
            title="Copy message"
            size={12}
          />
        </div>
      )}
      {(hasVisibleBlocks || showProgress) && (
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
            registerPendingForm={registerPendingForm}
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
