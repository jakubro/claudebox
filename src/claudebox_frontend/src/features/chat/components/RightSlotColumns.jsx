/** Mounts whichever right-slot view is active - terminal, work, or neither. */

// audit-ignore-file: excessive-props

import ColumnMinimap from './ColumnMinimap'
import TerminalColumn from './terminal'
import WorkColumn from './work'

/**
 * Extracted out of `ChatPanel` to keep it below the cognitive-complexity gate - the two views'
 * conditionals live here instead of adding two more branches to that function's own score.
 *
 * @param {boolean} props.showTerminalSplit - Width-aware visibility of the terminal view.
 * @param {boolean} props.showWorkView - Effective (width-aware) visibility of the work view.
 * @param {boolean} props.showReplayOverlay - Suppresses each view's minimap while the loading
 *   screen covers this slot, which shares its z-index and would otherwise paint through.
 * @param {Array} props.turns - Every turn in the session, forwarded to `WorkColumn` unsliced.
 */
export default function RightSlotColumns({
  showTerminalSplit,
  showWorkView,
  showReplayOverlay,
  isMobile,
  terminalEntries,
  onTerminalEntryClick,
  terminalContainerRef,
  terminalVirtualizerRef,
  terminalTrailingEntryRef,
  onTerminalScroll,
  scrollTerminalToBottom,
  terminalMetricsCacheRef,
  terminalMinimapPinned,
  terminalBars,
  getTerminalAutoScrollEnabled,
  getTerminalLogicalScrollHeight,
  onTerminalMinimapLanding,
  turns,
  mode,
  activeTurnId,
  isActive,
  now,
  todoDiffs,
  taskNotifications,
  duplicateAskUserIds,
  hasPendingMessages,
  onFormSubmit,
  registerPendingForm,
  onEntryJump,
  workContainerRef,
  workVirtualizerRef,
  onWorkScroll,
  scrollWorkToBottom,
  workMetricsCacheRef,
  workMinimapPinned,
  workBars,
  getWorkAutoScrollEnabled,
  getWorkLogicalScrollHeight,
  onWorkMinimapLanding,
}) {
  return (
    <>
      {showTerminalSplit && (
        <>
          <TerminalColumn
            entries={terminalEntries}
            onEntryClick={onTerminalEntryClick}
            containerRef={terminalContainerRef}
            virtualizerRef={terminalVirtualizerRef}
            trailingEntryRef={terminalTrailingEntryRef}
            onScroll={onTerminalScroll}
            scrollToBottom={scrollTerminalToBottom}
            metricsCacheRef={terminalMetricsCacheRef}
            minimapPinned={terminalMinimapPinned && !isMobile}
          />
          {!(isMobile || showReplayOverlay) && (
            <ColumnMinimap
              variant="terminal"
              bars={terminalBars}
              containerRef={terminalContainerRef}
              getAutoScrollEnabled={getTerminalAutoScrollEnabled}
              getLogicalScrollHeight={getTerminalLogicalScrollHeight}
              onScrollLanding={onTerminalMinimapLanding}
              persistent={terminalMinimapPinned}
            />
          )}
        </>
      )}
      {showWorkView && (
        <>
          <WorkColumn
            turns={turns}
            mode={mode}
            activeTurnId={activeTurnId}
            isActive={isActive}
            now={now}
            todoDiffs={todoDiffs}
            taskNotifications={taskNotifications}
            duplicateAskUserIds={duplicateAskUserIds}
            hasPendingMessages={hasPendingMessages}
            onFormSubmit={onFormSubmit}
            registerPendingForm={registerPendingForm}
            onEntryJump={onEntryJump}
            containerRef={workContainerRef}
            virtualizerRef={workVirtualizerRef}
            onScroll={onWorkScroll}
            scrollToBottom={scrollWorkToBottom}
            metricsCacheRef={workMetricsCacheRef}
            minimapPinned={workMinimapPinned && !isMobile}
          />
          {!(isMobile || showReplayOverlay) && (
            <ColumnMinimap
              variant="work"
              bars={workBars}
              containerRef={workContainerRef}
              getAutoScrollEnabled={getWorkAutoScrollEnabled}
              getLogicalScrollHeight={getWorkLogicalScrollHeight}
              onScrollLanding={onWorkMinimapLanding}
              persistent={workMinimapPinned}
            />
          )}
        </>
      )}
    </>
  )
}
