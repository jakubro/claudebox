/** A session row with its session id bound into each callback once, so the row's memo holds. */

// audit-ignore-file: excessive-props

import { memo, useMemo } from 'react'
import SessionItem from './SessionItem'

/**
 * Session-id-taking handlers in, bound per-row callbacks out; the bindings change only when a handler
 * does, so a parent re-render leaves an unchanged row alone.
 *
 * @param {object} props
 * @param {object} props.session - Session data.
 * @param {'none'|'running'|'stopping'} props.status - Container status.
 * @param {string} [props.dot] - The dot's state.
 * @param {string|null} [props.reason] - Why the session needs you.
 * @param {boolean} props.isCurrent - Whether this is the active session.
 * @param {boolean} props.isPinned - Whether this session is pinned.
 * @param {(sessionId: string) => void} props.onResume - Resume handler.
 * @param {(sessionId: string, name: string|null) => void} props.onRename - Rename handler.
 * @param {(sessionId: string) => void} [props.onTogglePin] - Pin handler (desktop only).
 * @param {(sessionId: string) => void} [props.onKillContainer] - Stop handler (desktop only).
 * @param {(sessionId: string) => void} [props.onOpenInNewTab] - New-tab handler (desktop only).
 * @param {string|null} [props.originName] - Origin line under an origin filter.
 * @param {boolean} [props.isMobile=false] - Mobile card layout.
 * @param {function} [props.onClose] - Close the mobile drawer.
 */
function BoundSessionItem({
  session,
  status,
  dot,
  reason,
  isCurrent,
  isPinned,
  onResume,
  onRename,
  onTogglePin,
  onKillContainer,
  onOpenInNewTab,
  originName,
  isMobile = false,
  onClose,
}) {
  const sessionId = session.session_id
  const callbacks = useMemo(
    () => ({
      onResume: () => onResume(sessionId),
      onRename: name => onRename(sessionId, name),
      actions: isMobile
        ? undefined
        : {
            onTogglePin: () => onTogglePin(sessionId),
            onKillContainer: () => onKillContainer(sessionId),
            onOpenInNewTab: () => onOpenInNewTab(sessionId),
          },
    }),
    [sessionId, isMobile, onResume, onRename, onTogglePin, onKillContainer, onOpenInNewTab],
  )

  return (
    <SessionItem
      session={session}
      status={status}
      dot={dot}
      reason={reason}
      isCurrent={isCurrent}
      isPinned={isPinned}
      originName={originName}
      isMobile={isMobile}
      onClose={onClose}
      {...callbacks}
    />
  )
}

export default memo(BoundSessionItem)
