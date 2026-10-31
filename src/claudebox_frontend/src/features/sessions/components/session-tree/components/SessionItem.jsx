/** Individual session item with edit and resume functionality. */

// audit-ignore-file: excessive-props

import { Check, Loader2, Pencil, Pin, Square, X } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import useCopyFlash from '../../../../../hooks/useCopyFlash'
import useRelativeTime from '../../../../../hooks/useRelativeTime'
import { flashStatus } from '../../../../../utils/flashStatus'
import {
  formatAbsoluteTime,
  formatCost,
  formatMessagePreview,
  formatTurns,
} from '../../../../../utils/formatters'
import { formatSessionDirTooltip } from '../../../../../utils/session'
import { displayName, isAutoNamed } from '../../../../../utils/sessionName'
import { DOT_TITLES } from '../../../../../utils/sessionRow'
import ResumeSplitButton from './ResumeSplitButton'

/**
 * @param {object} props
 * @param {object} props.session - Session data with id, name, timestamps, messages.
 * @param {'none'|'running'|'stopping'} [props.status='none'] - Container status.
 * @param {string} [props.dot=status] - The dot's state: the container status or what the session is doing.
 * @param {string|null} [props.reason] - Why the session needs you; shown in place of its last message.
 * @param {boolean} props.isCurrent - Whether this is the active session.
 * @param {boolean} props.isPinned - Whether this session is pinned.
 * @param {function} props.onResume - Resume callback.
 * @param {function} props.onRename - Rename callback.
 * @param {object} [props.actions] - Desktop-only action callbacks.
 * @param {function} [props.actions.onTogglePin] - Pin toggle callback.
 * @param {function} [props.actions.onKillContainer] - Kill container callback.
 * @param {function} [props.actions.onOpenInNewTab] - Open in new browser tab callback.
 * @param {function} [props.onClose] - Close drawer callback (mobile only, fired on current-session tap).
 * @param {boolean} [props.isMobile=false] - Mobile flag - hides pin/kill/resume-split, makes whole card the resume tap target.
 * @param {string|null} [props.originName] - Under an origin filter, the name of the session this
 *   one came from; when absent the line reads as absent rather than showing a raw id.
 */
function SessionItem({
  session,
  status = 'none',
  dot = status,
  reason = null,
  isCurrent,
  isPinned,
  onResume,
  onRename,
  actions: { onTogglePin, onKillContainer, onOpenInNewTab } = {},
  onClose,
  isMobile = false,
  originName,
}) {
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

  const startedTime = useRelativeTime(session.started_at)
  const updatedTime = useRelativeTime(session.updated_at)
  // Memoize the two tooltip-only `toLocaleString` calls - sub-ms each but cumulative across rows x flush rate.
  const startedAbsolute = useMemo(
    () => formatAbsoluteTime(session.started_at),
    [session.started_at],
  )
  const updatedAbsolute = useMemo(
    () => (session.updated_at ? formatAbsoluteTime(session.updated_at) : null),
    [session.updated_at],
  )

  const copySessionPath = () => copy(session.session_dir)
  const shownName = displayName(session)

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

  // Mobile: whole card is the tap target - non-current resumes, current closes the drawer; edit-mode
  // swallows clicks via its own inputs, and the pencil click stops propagation itself.
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
            className={`container-status-dot container-status-${dot}`}
            title={DOT_TITLES[dot]}
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
          {shownName && (
            <span
              className={`sessions-name${isAutoNamed(session) ? ' auto-named' : ''}`}
              title={shownName}>
              {shownName}
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
            <span title={`Started — ${startedAbsolute}`}>{startedTime}</span>
            {updatedTime && updatedTime !== startedTime && (
              <>
                {' – '}
                <span title={`Last active — ${updatedAbsolute}`}>{updatedTime}</span>
              </>
            )}
          </span>
          {(session.num_turns != null || session.total_cost_usd != null) && (
            <span className="sessions-meta-extra">
              {' · '}
              <span title={`Turns — ${session.num_turns ?? 0}`}>
                {formatTurns(session.num_turns)}
              </span>
              {' · '}
              <span title={`API cost this session — $${(session.total_cost_usd ?? 0).toFixed(2)}`}>
                {formatCost(session.total_cost_usd)}
              </span>
              {session.runtime && (
                <>
                  {' · '}
                  <span
                    className="sessions-runtime-badge"
                    title={`Runtime — ${session.runtime}`}
                    data-testid="sessions-runtime-badge">
                    {session.runtime}
                  </span>
                </>
              )}
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
          {/* A side thread's status (when live) resolves through its parent's container - killing
              it here would delete that container and take the parent down too. */}
          {!isMobile && status !== 'none' && !session.is_side_thread && (
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
            <span title={`Turns — ${session.num_turns ?? 0}`}>
              {formatTurns(session.num_turns)}
            </span>
            {' · '}
            <span title={`API cost this session — $${(session.total_cost_usd ?? 0).toFixed(2)}`}>
              {formatCost(session.total_cost_usd)}
            </span>
            {session.runtime && (
              <>
                {' · '}
                <span title={`Runtime — ${session.runtime}`} data-testid="sessions-runtime-badge">
                  {session.runtime}
                </span>
              </>
            )}
          </>
        ) : (
          '\u00A0'
        )}
      </div>

      <div className="sessions-row sessions-first">
        {session.first_message ? (
          <span title={formatMessagePreview(session.first_message)}>
            "{formatMessagePreview(session.first_message)}"
          </span>
        ) : (
          '\u00A0'
        )}
      </div>

      {originName !== undefined && (
        <div className="sessions-row sessions-origin" data-testid="session-origin">
          {originName ? `from: ${originName}` : '\u00A0'}
        </div>
      )}

      <div className={`sessions-row sessions-last${reason ? ' sessions-last-needs-you' : ''}`}>
        {reason ? (
          <span title={reason}>{reason}</span>
        ) : session.last_message && session.last_message !== session.first_message ? (
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

// Memo barrier: every prop is a primitive or a callback bound once per row (BoundSessionItem), so a
// list re-render redraws only rows whose own session, status, dot or highlight changed.
export default memo(SessionItem)
