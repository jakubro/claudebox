/** Control bar with session actions and navigation buttons. */

import {
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  GitFork,
  Loader2,
  Map as MapIcon,
  Package,
  Pin,
  RefreshCw,
} from 'lucide-react'
import { useCallback } from 'react'
import { sendMessage } from '../../../../api/chat'
import PanelControlBar from '../../../../components/PanelControlBar/PanelControlBar'
import { useSessionActions, useSessionData } from '../../../../context/SessionDataContext'
import { useSessionsList } from '../../../../context/SessionsContext'
import useCapabilities from '../../../../hooks/useCapabilities'
import useDropdown from '../../../../hooks/useDropdown'
import useIsMobile from '../../../../hooks/useIsMobile'
import SessionPromptEditor from '../session-prompt'
import SessionNameEditor from './components/SessionNameEditor'

/**
 * Render control bar with pin, rename, reload, compact, fork, and navigation buttons.
 * @param {Object} props
 * @param {Function} props.onReload - Callback to reload session
 * @param {Function} props.onFork - Callback receiving fork mode string
 * @param {boolean} props.forking - Whether a fork is in progress
 * @param {Object} props.messagesRef - Ref to messages container for scroll
 * @param {Object} props.autoScrollEnabledRef - Ref tracking auto-scroll state
 * @param {boolean} props.isAutoScrollEnabled - Whether auto-scroll is active
 * @param {Function} props.onJumpPrev - Callback to jump to previous message
 * @param {Function} props.onJumpNext - Callback to jump to next message
 * @param {boolean} props.minimapPinned - Whether minimap is pinned visible
 * @param {Function} props.onToggleMinimap - Callback to toggle minimap pinned state
 */
export default function ChatControlBar({
  onReload,
  onFork,
  forking = false,
  messagesRef,
  autoScrollEnabledRef,
  isAutoScrollEnabled,
  onJumpPrev,
  onJumpNext,
  minimapPinned,
  onToggleMinimap,
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
    // The session header strip reads sessionName from SessionDataContext;
    // refreshSession() flowing through updates the visible title. The dockview
    // tab carries no session title.
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
    <PanelControlBar>
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
