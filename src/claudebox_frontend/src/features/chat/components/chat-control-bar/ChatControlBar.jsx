/** Control bar with session actions and navigation buttons. */

// audit-ignore-file: excessive-props

import {
  ArrowDownToLine,
  ChevronDown,
  ChevronsDownUp,
  ChevronUp,
  GitFork,
  Loader2,
  Map as MapIcon,
  Package,
  Pin,
  RefreshCw,
  SquareSplitHorizontal,
  Wrench,
} from 'lucide-react'
import { useCallback } from 'react'
import { sendMessage } from '../../../../api/chat'
import PanelControlBar from '../../../../components/PanelControlBar/PanelControlBar'
import { useSessionActions, useSessionData } from '../../../../context/SessionDataContext'
import { useSessionsList } from '../../../../context/SessionsContext'
import useCapabilities from '../../../../hooks/useCapabilities'
import useDropdown from '../../../../hooks/useDropdown'
import useIsMobile from '../../../../hooks/useIsMobile'
import { RightSlotView } from '../../utils/rightSlotViews'
import SessionPromptEditor from '../session-prompt'
import SessionNameEditor from './components/SessionNameEditor'

/**
 * @param {Object} props
 * @param {Function} props.onFork - Receives a fork mode string.
 * @param {string} props.rightSlotView - Right-slot preference; drives only the picker's button.
 * @param {boolean} props.showTerminalSplit - Width-aware visibility of the terminal view.
 * @param {boolean} props.showWorkView - Width-aware visibility of the work view.
 * @param {number} props.terminalSplitRatio - Transcript column's share, 0-1; sets the division.
 * @param {boolean} props.terminalAutoScrollEnabled - Terminal column's own following state.
 * @param {Function} props.onTerminalJumpToBottom - Returns the terminal to its newest entry.
 * @param {Function} props.onTerminalJumpPrev - Steps the terminal to the nearest entry above.
 * @param {Function} props.onTerminalJumpNext - Steps the terminal to the next entry below.
 * @param {boolean} props.terminalMinimapPinned - Terminal overview's own pin state.
 * @param {Function} props.onToggleTerminalMinimap - Toggles the terminal overview's pin.
 * @param {boolean} props.workAutoScrollEnabled - Work column's own following state.
 * @param {Function} props.onWorkJumpToBottom - Returns the work column to its newest entry.
 * @param {Function} props.onWorkJumpPrev - Steps the work column to the nearest working turn above.
 * @param {Function} props.onWorkJumpNext - Steps the work column to the next working turn below.
 * @param {boolean} props.workMinimapPinned - Work overview's own pin state.
 * @param {Function} props.onToggleWorkMinimap - Toggles the work overview's pin.
 */
export default function ChatControlBar({
  onReload,
  onFork,
  forking = false,
  messagesRef,
  autoScrollEnabledRef,
  isAutoScrollEnabled,
  autoCollapseEnabled,
  onToggleAutoCollapse,
  onJumpPrev,
  onJumpNext,
  minimapPinned,
  onToggleMinimap,
  rightSlotView,
  onSelectRightSlotView,
  showTerminalSplit,
  showWorkView,
  terminalSplitRatio,
  terminalAutoScrollEnabled,
  onTerminalJumpToBottom,
  onTerminalJumpPrev,
  onTerminalJumpNext,
  terminalMinimapPinned,
  onToggleTerminalMinimap,
  workAutoScrollEnabled,
  onWorkJumpToBottom,
  onWorkJumpPrev,
  onWorkJumpNext,
  workMinimapPinned,
  onToggleWorkMinimap,
}) {
  const isMobile = useIsMobile()
  const { capabilities } = useCapabilities()
  const { sessionId, sessionName } = useSessionData()
  const { refreshSession } = useSessionActions()
  const { pinnedSessions, togglePin, refresh } = useSessionsList()

  const {
    isOpen: isForkMenuOpen,
    setIsOpen: setForkMenuOpen,
    containerRef: forkMenuRef,
    handleToggle: toggleForkMenu,
    handleKeyDown: forkMenuKeyDown,
  } = useDropdown(!sessionId)

  const handleFork = useCallback(
    mode => {
      setForkMenuOpen(false)
      onFork?.(mode)
    },
    [onFork, setForkMenuOpen],
  )

  if (isMobile) {
    return null
  }

  const isPinned = sessionId ? pinnedSessions.includes(sessionId) : false

  const handleTogglePin = () => {
    if (sessionId) {
      togglePin(sessionId)
    }
  }

  const handleSaved = _newName => {
    // Session header strip reads sessionName from SessionDataContext; refreshSession() updates the visible title.
    void refresh()
    void refreshSession()
  }

  const handleCompact = async () => {
    try {
      await sendMessage('/compact')
    } catch (e) {
      console.warn('ChatControlBar: Failed to send /compact', e)
    }
  }

  const handleJumpToBottom = () => {
    if (messagesRef?.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
      if (autoScrollEnabledRef) {
        autoScrollEnabledRef.current = true
      }
    }
  }

  return (
    <PanelControlBar
      splitRatio={showTerminalSplit || showWorkView ? terminalSplitRatio : undefined}
      rightContent={
        showTerminalSplit ? (
          <div className="panel-control-group">
            <button
              type="button"
              className="panel-control-btn"
              onClick={onTerminalJumpPrev}
              data-testid="terminal-jump-prev"
              title="Previous entry (Alt+PageUp)">
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              className="panel-control-btn"
              onClick={onTerminalJumpNext}
              data-testid="terminal-jump-next"
              title="Next entry (Alt+PageDown)">
              <ChevronDown size={12} />
            </button>
            <span className="panel-control-separator" />
            <button
              type="button"
              className={`panel-control-btn${terminalAutoScrollEnabled ? ' pressed' : ''}`}
              onClick={onTerminalJumpToBottom}
              disabled={terminalAutoScrollEnabled}
              aria-pressed={terminalAutoScrollEnabled}
              data-testid="terminal-autoscroll-indicator"
              title={terminalAutoScrollEnabled ? 'Autoscroll enabled' : 'Jump to newest entry'}>
              <ArrowDownToLine size={12} />
            </button>
            <span className="panel-control-separator" />
            <button
              type="button"
              className={`panel-control-btn${terminalMinimapPinned ? ' pressed' : ''}`}
              onClick={onToggleTerminalMinimap}
              aria-pressed={terminalMinimapPinned}
              data-testid="terminal-minimap-toggle"
              title={terminalMinimapPinned ? 'Hide terminal overview' : 'Show terminal overview'}>
              <MapIcon size={12} />
            </button>
          </div>
        ) : showWorkView ? (
          <div className="panel-control-group">
            <button
              type="button"
              className="panel-control-btn"
              onClick={onWorkJumpPrev}
              data-testid="work-jump-prev"
              title="Previous turn (Alt+PageUp)">
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              className="panel-control-btn"
              onClick={onWorkJumpNext}
              data-testid="work-jump-next"
              title="Next turn (Alt+PageDown)">
              <ChevronDown size={12} />
            </button>
            <span className="panel-control-separator" />
            <button
              type="button"
              className={`panel-control-btn${workAutoScrollEnabled ? ' pressed' : ''}`}
              onClick={onWorkJumpToBottom}
              disabled={workAutoScrollEnabled}
              aria-pressed={workAutoScrollEnabled}
              data-testid="work-autoscroll-indicator"
              title={workAutoScrollEnabled ? 'Autoscroll enabled' : 'Jump to newest entry'}>
              <ArrowDownToLine size={12} />
            </button>
            <span className="panel-control-separator" />
            <button
              type="button"
              className={`panel-control-btn${workMinimapPinned ? ' pressed' : ''}`}
              onClick={onToggleWorkMinimap}
              aria-pressed={workMinimapPinned}
              data-testid="work-minimap-toggle"
              title={workMinimapPinned ? 'Hide work overview' : 'Show work overview'}>
              <MapIcon size={12} />
            </button>
          </div>
        ) : undefined
      }>
      <SessionNameEditor sessionId={sessionId} sessionName={sessionName} onSaved={handleSaved}>
        {({ renameButton }) => (
          <div className="panel-control-group">
            <button
              type="button"
              className={`panel-control-btn${isPinned ? ' pressed' : ''}`}
              onClick={handleTogglePin}
              disabled={!sessionId}
              aria-pressed={isPinned}
              data-control="pin"
              title={isPinned ? 'Unpin session' : 'Pin session'}>
              <Pin size={12} />
            </button>
            {renameButton}
            <span className="panel-control-separator" />
            <button
              type="button"
              className="panel-control-btn"
              onClick={onReload}
              title="Reload session (picks up config changes)">
              <RefreshCw size={12} />
            </button>
            {(!capabilities || capabilities.supports_manual_compact) && (
              <button
                type="button"
                className="panel-control-btn"
                onClick={handleCompact}
                title="Compact conversation (/compact)"
                data-testid="chat-control-compact">
                <Package size={12} />
              </button>
            )}
            {(!capabilities || capabilities.supports_session_fork) && (
              <span
                className="chat-control-fork-split"
                ref={forkMenuRef}
                onKeyDown={forkMenuKeyDown}
                data-testid="chat-control-fork">
                <button
                  type="button"
                  className="panel-control-btn"
                  onClick={e => {
                    if (e?.altKey) {
                      handleFork('fork-browser-tab')
                      return
                    }
                    handleFork('fork-here')
                  }}
                  onAuxClick={e => {
                    if (e.button === 1) {
                      e.preventDefault()
                      handleFork('fork-browser-tab')
                    }
                  }}
                  disabled={!sessionId || forking}
                  title="Fork session (Alt+Click or middle-click for new browser tab)">
                  {forking ? <Loader2 size={12} className="spin" /> : <GitFork size={12} />}
                </button>
                <button
                  type="button"
                  className="panel-control-btn chat-control-fork-chevron"
                  onClick={toggleForkMenu}
                  disabled={!sessionId || forking}
                  title="Fork options">
                  <ChevronDown size={8} />
                </button>
                {isForkMenuOpen && (
                  <div className="dropdown-menu chat-control-fork-dropdown">
                    <button
                      type="button"
                      className="dropdown-option"
                      onClick={() => handleFork('fork-here')}>
                      Fork here
                    </button>
                    <button
                      type="button"
                      className="dropdown-option"
                      onClick={() => handleFork('fork-browser-tab')}>
                      Fork in new browser tab
                    </button>
                  </div>
                )}
              </span>
            )}
            <span className="panel-control-separator" />
            <SessionPromptEditor disabled={!sessionId} />
            <span className="panel-control-separator" />
            <button
              type="button"
              className={`panel-control-btn${autoCollapseEnabled ? ' pressed' : ''}`}
              onClick={onToggleAutoCollapse}
              aria-pressed={autoCollapseEnabled}
              data-testid="autocollapse-toggle"
              title={autoCollapseEnabled ? 'Disable auto-collapse' : 'Enable auto-collapse'}>
              <ChevronsDownUp size={12} />
            </button>
            <fieldset
              className="chat-control-right-slot-picker"
              aria-label="Right column view"
              data-testid="right-slot-view-picker">
              <button
                type="button"
                className={`panel-control-btn${rightSlotView === RightSlotView.TERMINAL ? ' pressed' : ''}`}
                onClick={() =>
                  onSelectRightSlotView(
                    rightSlotView === RightSlotView.TERMINAL
                      ? RightSlotView.OFF
                      : RightSlotView.TERMINAL,
                  )
                }
                aria-pressed={rightSlotView === RightSlotView.TERMINAL}
                data-testid="right-slot-view-terminal"
                title={
                  rightSlotView === RightSlotView.TERMINAL
                    ? "Hide agent's terminal"
                    : "Show agent's terminal"
                }>
                <SquareSplitHorizontal size={12} />
              </button>
              <button
                type="button"
                className={`panel-control-btn${rightSlotView === RightSlotView.WORK ? ' pressed' : ''}`}
                onClick={() =>
                  onSelectRightSlotView(
                    rightSlotView === RightSlotView.WORK ? RightSlotView.OFF : RightSlotView.WORK,
                  )
                }
                aria-pressed={rightSlotView === RightSlotView.WORK}
                data-testid="right-slot-view-work"
                title={
                  rightSlotView === RightSlotView.WORK
                    ? 'Hide the work panel'
                    : "Show the agent's work"
                }>
                <Wrench size={12} />
              </button>
            </fieldset>
          </div>
        )}
      </SessionNameEditor>
      <div className="panel-control-group">
        <button
          type="button"
          className="panel-control-btn"
          onClick={onJumpPrev}
          title="Previous message (Alt+Up)">
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          className="panel-control-btn"
          onClick={onJumpNext}
          title="Next message (Alt+Down)">
          <ChevronDown size={12} />
        </button>
        <span className="panel-control-separator" />
        <button
          type="button"
          className={`panel-control-btn${isAutoScrollEnabled ? ' pressed' : ''}`}
          onClick={handleJumpToBottom}
          disabled={isAutoScrollEnabled}
          aria-pressed={isAutoScrollEnabled}
          data-testid="autoscroll-indicator"
          title={isAutoScrollEnabled ? 'Autoscroll enabled' : 'Last message (Alt+End)'}>
          <ArrowDownToLine size={12} />
        </button>
        <span className="panel-control-separator" />
        <button
          type="button"
          className={`panel-control-btn${minimapPinned ? ' pressed' : ''}`}
          onClick={onToggleMinimap}
          aria-pressed={minimapPinned}
          data-testid="control-minimap-toggle"
          title={minimapPinned ? 'Hide minimap' : 'Show minimap'}>
          <MapIcon size={12} />
        </button>
      </div>
    </PanelControlBar>
  )
}
