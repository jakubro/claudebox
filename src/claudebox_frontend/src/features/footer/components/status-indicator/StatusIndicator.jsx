/** Connection status indicator for footer. */

import { ConnectionStatus, InterruptStatus } from '../../../../config/schema'
import ActiveStatus from './components/ActiveStatus'

/**
 * Render connection status indicator showing current state.
 *
 * @param {object} props
 * @param {string} props.connectionStatus - WebSocket connection state.
 * @param {string|null} props.connectionError - Connection error message.
 * @param {boolean} props.isResponding - Whether Claude is actively streaming.
 * @param {number|null} props.respondingSince - Timestamp when current response started.
 * @param {number|null} props.lastEventTimestamp - Timestamp of last SSE event.
 * @param {boolean} props.isSubmitting - Whether a request is being submitted.
 * @param {boolean} props.isAwaitingResponse - Whether waiting for first response.
 * @param {string|null} props.interruptStatus - Interrupt state ("stopping"|"stopped"|null).
 * @param {string|null} props.errorMessage - Error message to display.
 * @param {boolean} props.isReplaying - Whether session history is replaying.
 * @param {boolean} props.isCreating - Whether a new session is being created.
 * @param {boolean} props.isForking - Whether a fork operation is in flight.
 * @param {boolean} props.isOpeningBoard - Whether a board open transition is painting.
 * @param {boolean} props.isOpeningWorkspace - Whether a workspace new-tab open is painting.
 */
export default function StatusIndicator({
  connectionStatus,
  connectionError,
  isResponding,
  respondingSince,
  lastEventTimestamp,
  isSubmitting,
  isAwaitingResponse,
  interruptStatus,
  errorMessage,
  isReplaying,
  isCreating,
  isForking,
  isOpeningBoard,
  isOpeningWorkspace,
}) {
  // Resuming state (highest priority during session load)
  if (isReplaying) {
    return (
      <>
        <span
          className="status-dot status-connected status-working"
          data-testid="footer-status"
          data-status="resuming"
        />
        <span className="footer-item footer-status-text">
          Resuming<span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </>
    )
  }

  // Forking state — ranks above creating because fork-here reuses the current
  // tab and must show feedback before the new session takes over.
  if (isForking) {
    return (
      <>
        <span
          className="status-dot status-connected status-working"
          data-testid="footer-status"
          data-status="forking"
        />
        <span className="footer-item footer-status-text">
          Forking<span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </>
    )
  }

  // Creating session state
  if (isCreating) {
    return (
      <>
        <span
          className="status-dot status-connected status-working"
          data-testid="footer-status"
          data-status="creating"
        />
        <span className="footer-item footer-status-text">
          Creating session<span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </>
    )
  }

  // Opening board state — synchronous local transition, brief paint feedback
  if (isOpeningBoard) {
    return (
      <>
        <span
          className="status-dot status-connected status-working"
          data-testid="footer-status"
          data-status="opening-board"
        />
        <span className="footer-item footer-status-text">
          Opening board<span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </>
    )
  }

  // Opening workspace state — synchronous local transition, brief paint feedback
  if (isOpeningWorkspace) {
    return (
      <>
        <span
          className="status-dot status-connected status-working"
          data-testid="footer-status"
          data-status="opening-workspace"
        />
        <span className="footer-item footer-status-text">
          Opening workspace<span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </>
    )
  }

  // Error state (highest priority)
  if (errorMessage) {
    return (
      <>
        <span className="status-dot status-error" data-testid="footer-status" data-status="error" />
        <span className="footer-item footer-error-text">{errorMessage}</span>
      </>
    )
  }

  if (connectionStatus === ConnectionStatus.CONNECTED) {
    // Stopping/Stopped states (interrupt in progress or completed)
    if (interruptStatus === InterruptStatus.STOPPING) {
      return (
        <>
          <span
            className="status-dot status-stopping"
            data-testid="footer-status"
            data-status="stopping"
          />
          <span className="footer-item footer-status-text">
            Stopping<span className="dot dot-1">.</span>
            <span className="dot dot-2">.</span>
            <span className="dot dot-3">.</span>
          </span>
        </>
      )
    }
    if (interruptStatus === InterruptStatus.STOPPED) {
      return (
        <>
          <span
            className="status-dot status-stopped"
            data-testid="footer-status"
            data-status="stopped"
          />
          <span className="footer-item">Stopped</span>
        </>
      )
    }

    // Working state (Claude responding or awaiting response)
    if (isResponding || isAwaitingResponse) {
      return (
        <ActiveStatus
          label="Working"
          status="working"
          respondingSince={respondingSince}
          lastEventTimestamp={lastEventTimestamp}
        />
      )
    }

    // Submitting state (POST in flight)
    if (isSubmitting) {
      return <ActiveStatus label="Submitting" status="submitting" />
    }

    // Ready state (idle)
    return (
      <>
        <span
          className="status-dot status-connected"
          data-testid="footer-status"
          data-status="ready"
        />
        <span className="footer-item">Ready</span>
      </>
    )
  }

  // Reconnecting state — exponential backoff in progress
  if (connectionStatus === ConnectionStatus.RECONNECTING) {
    return (
      <>
        <span
          className="status-dot status-error"
          data-testid="footer-status"
          data-status="reconnecting"
        />
        <span className="footer-item footer-status-text">
          Reconnecting<span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </>
    )
  }

  return (
    <>
      <span
        className={`status-dot status-${connectionStatus}`}
        data-testid="footer-status"
        data-status={connectionStatus}
      />
      <span className="footer-item">
        {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
      </span>
      {connectionError && <span className="footer-error">({connectionError})</span>}
    </>
  )
}
