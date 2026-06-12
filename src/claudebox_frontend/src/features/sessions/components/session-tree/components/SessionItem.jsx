/** Individual session item with edit and resume functionality. */

import { Check, Loader2, Pencil, Pin, Square, X } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useContainerMap } from '../../../../../context/ContainerMapContext'
import useCopyFlash from '../../../../../hooks/useCopyFlash'
import { flashStatus } from '../../../../../utils/flashStatus'
import {
  formatAbsoluteTime,
  formatCost,
  formatMessagePreview,
  formatRelativeTime,
  formatTurns,
} from '../../../../../utils/formatters'
import { formatSessionDirTooltip } from '../../../../../utils/session'
import ResumeSplitButton from './ResumeSplitButton'

/**
 * Render a session item with display, edit, and resume functionality.
 * @param {object} props
 * @param {object} props.session - Session data with id, name, timestamps, messages.
 * @param {boolean} props.isCurrent - Whether this is the active session.
 * @param {boolean} props.isPinned - Whether this session is pinned.
 * @param {function} props.onResume - Resume callback.
 * @param {function} props.onRename - Rename callback.
 * @param {function} [props.onTogglePin] - Pin toggle callback (desktop only).
 * @param {function} [props.onKillContainer] - Kill container callback (desktop only).
 * @param {function} [props.onOpenInNewTab] - Open in new browser tab callback (desktop only).
 * @param {function} [props.onClose] - Close drawer callback (mobile only, fired on current-session tap).
 * @param {boolean} [props.isMobile=false] - Mobile flag - hides pin/kill/resume-split, makes whole card the resume tap target.
 */
function SessionItem({
  session,
  isCurrent,
  isPinned,
  onResume,
  onRename,
  onTogglePin,
  onKillContainer,
  onOpenInNewTab,
  onClose,
  isMobile = false,
}) {
  const { deriveSessionStatus } = useContainerMap()
  const status = deriveSessionStatus(session.session_id, undefined, session.container_id)
  const isStopping = status === 'stopping'

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [copied, copy] = useCopyFlash()
  const [isResuming, setIsResuming] = useState(false)

  /** Show a brief spinner while a resume action paints. */
  const handleResumeWithSpinner = useCallback(action => {
    flashStatus(
      () => setIsResuming(true),
      () => setIsResuming(false),
    )
    action()
  }, [])

  const startedTime = formatRelativeTime(session.started_at)
  const updatedTime = session.updated_at ? formatRelativeTime(session.updated_at) : null
  // Memoize the two tooltip-only `toLocaleString` calls - formatters are
  // sub-millisecond but cumulative across rows × flush rate.
  const startedAbsolute = useMemo(
    () => formatAbsoluteTime(session.started_at),
    [session.started_at],
  )
  const updatedAbsolute = useMemo(
    () => (session.updated_at ? formatAbsoluteTime(session.updated_at) : null),
    [session.updated_at],
  )

  const copySessionPath = () => copy(session.session_dir)

  const handleEditStart = () => {
    setIsEditing(true)
    setEditName(session.name || '')
  }

  const handleEditCancel = () => {
    setIsEditing(false)
    setEditName('')
  }

  const handleEditSave = async () => {
    await onRename(editName || null)
    setIsEditing(false)
    setEditName('')
  }

  // Mobile: whole card is the tap target. Non-current -> resume; current -> close
  // the drawer (no resume call). Edit-mode swallows clicks via the edit-row's
  // own inputs; pencil click in display mode adds its own stopPropagation.
  const handleCardClick =
    isMobile && !isEditing
      ? () => (isCurrent ? onClose?.() : handleResumeWithSpinner(() => onResume()))
      : undefined

  return (
    <div
      className={`sessions-item ${isCurrent ? 'sessions-item-current' : ''}${isMobile ? ' sessions-item-mobile' : ''}`}
      data-testid="session-item"
      role={isMobile && !isEditing ? 'button' : undefined}
      tabIndex={isMobile && !isEditing ? 0 : undefined}
      onClick={handleCardClick}>
      {/* Row 1: Edit input or header */}
      {isEditing ? (
        <div className="sessions-row sessions-edit-row">
          <input
            type="text"
            className="sessions-edit-input"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            placeholder="Session name..."
            autoFocus
            onBlur={handleEditCancel}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleEditSave()
              }
              if (e.key === 'Escape') {
                handleEditCancel()
              }
            }}
          />
          <button
            type="button"
            className="sessions-edit-save"
            onMouseDown={e => e.preventDefault()}
            onClick={() => void handleEditSave()}
            title="Save">
            <Check size={12} />
          </button>
          <button
            type="button"
            className="sessions-edit-cancel"
            onMouseDown={e => e.preventDefault()}
            onClick={handleEditCancel}
            title="Cancel">
            <X size={12} />
          </button>
        </div>
      ) : (
        <div className="sessions-row sessions-header">
          <span
            className={`container-status-dot container-status-${status}`}
            title={
              status === 'stopping'
                ? 'Stopping container...'
                : status === 'running'
                  ? 'Container running'
                  : 'No container'
            }
          />
          <span
            className="sessions-id sessions-id-clickable"
            title={formatSessionDirTooltip(session.session_dir)}
            onClick={copySessionPath}
            style={{ cursor: session.session_dir ? 'pointer' : undefined }}>
            <span style={{ visibility: copied ? 'hidden' : 'visible' }}>
              {session.session_id.slice(0, 8)}
            </span>
            {copied && <span className="sessions-id-copied">Copied!</span>}
          </span>
          {session.name && (
            <span className="sessions-name" title={session.name}>
              {session.name}
            </span>
          )}
          <button
            type="button"
            className="sessions-edit-btn"
            onClick={e => {
              e.stopPropagation()
              handleEditStart()
            }}
            title="Rename session">
            <Pencil size={10} />
          </button>
        </div>
      )}

      {/* Row 2: Timestamp + Meta (wide) OR Timestamp + Buttons (narrow) */}
      <div className="sessions-row sessions-meta-row">
        <div className="sessions-meta-left">
          <span className="sessions-timestamp">
            <span title={`Started - ${startedAbsolute}`}>{startedTime}</span>
            {updatedTime && updatedTime !== startedTime && (
              <>
                {' -> '}
                <span title={`Last active - ${updatedAbsolute}`}>{updatedTime}</span>
              </>
            )}
          </span>
          {(session.num_turns != null || session.total_cost_usd != null) && (
            <span className="sessions-meta-extra">
              {' · '}
              <span title={`Turns - ${session.num_turns ?? 0}`}>
                {formatTurns(session.num_turns)}
              </span>
              {' · '}
              <span title={`API cost this session - $${(session.total_cost_usd ?? 0).toFixed(2)}`}>
                {formatCost(session.total_cost_usd)}
              </span>
            </span>
          )}
        </div>
        <div className="sessions-buttons">
          {!isMobile && (
            <button
              type="button"
              className={`sessions-pin-btn${isPinned ? ' pinned' : ''}`}
              data-testid="session-pin-btn"
              onClick={onTogglePin}
              title={isPinned ? 'Unpin session' : 'Pin session'}>
              <Pin size={12} />
            </button>
          )}
          {!isMobile && status !== 'none' && (
            <button
              type="button"
              className="sessions-kill-btn"
              data-testid="session-kill-btn"
              onClick={onKillContainer}
              disabled={isStopping}
              title={isStopping ? 'Stopping...' : 'Stop container'}>
              {isStopping ? <Loader2 size={12} className="spin" /> : <Square size={12} />}
            </button>
          )}
          {!(isMobile || isCurrent) && (
            <ResumeSplitButton
              isResuming={isResuming}
              onResume={onResume}
              onOpenInNewTab={onOpenInNewTab}
              onResumeWithSpinner={handleResumeWithSpinner}
            />
          )}
        </div>
      </div>

      {/* Row 3: Turns + Cost (narrow only, hidden in wide) */}
      <div className="sessions-row sessions-meta-overflow">
        {session.num_turns != null || session.total_cost_usd != null ? (
          <>
            <span title={`Turns - ${session.num_turns ?? 0}`}>
              {formatTurns(session.num_turns)}
            </span>
            {' · '}
            <span title={`API cost this session - $${(session.total_cost_usd ?? 0).toFixed(2)}`}>
              {formatCost(session.total_cost_usd)}
            </span>
          </>
        ) : (
          '\u00A0'
        )}
      </div>

      {/* Row 4: First message */}
      <div className="sessions-row sessions-first">
        {session.first_message ? (
          <span title={formatMessagePreview(session.first_message)}>
            "{formatMessagePreview(session.first_message)}"
          </span>
        ) : (
          '\u00A0'
        )}
      </div>

      {/* Row 5: Last message */}
      <div className="sessions-row sessions-last">
        {session.last_message && session.last_message !== session.first_message ? (
          <span title={formatMessagePreview(session.last_message)}>
            "...{formatMessagePreview(session.last_message)}"
          </span>
        ) : (
          '\u00A0'
        )}
      </div>
    </div>
  )
}

// Memo barrier: SessionTree re-renders 20\u00D7/sec during streaming because its
// parent SessionsPanel ultimately sources status from a context that flushes
// at SSE batch cadence. Default shallow compare suffices once SessionTree
// stops creating fresh arrow callbacks per render (see useMemo there).
export default memo(SessionItem)
