/** Turn progress indicator showing working, stopping, or completion state. */

import useCapabilities from '../../../../../hooks/useCapabilities'
import { formatDuration } from '../../../../../utils/formatters'

/**
 * Render the turn progress indicator showing working, stopping, or completion state.
 * @param {Object} props
 * @param {boolean} props.isActive - Whether the turn is currently active.
 * @param {boolean} props.isStopping - Whether an interrupt is in progress.
 * @param {boolean} props.showProgress - Whether to show the progress spinner.
 * @param {boolean} props.hasActiveCompaction - Whether compaction is in progress.
 * @param {boolean} props.pending - Whether this is a pending turn (no events).
 * @param {boolean} props.hasPendingMessages - Whether pending messages exist.
 * @param {boolean} props.hasNextUserMessage - Whether another user message follows.
 * @param {number} props.duration - Turn duration in seconds.
 * @returns {JSX.Element|null}
 */
export default function TurnProgress({
  isActive,
  isStopping,
  showProgress,
  hasActiveCompaction,
  pending,
  hasPendingMessages,
  hasNextUserMessage,
  duration,
}) {
  const { capabilities } = useCapabilities()
  const compactionVisible =
    hasActiveCompaction && (!capabilities || capabilities.supports_pre_compact_hook)

  // For pending turns during compaction, show compaction spinner instead of "Working..."
  if (compactionVisible && pending) {
    return (
      <div className="turn-progress turn-progress-working" data-testid="turn-progress-working">
        <span className="progress-spinner">◎</span>
        <span>
          Compacting conversation
          <span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </div>
    )
  }
  if (compactionVisible) {
    return null
  }

  if (isActive || showProgress || isStopping) {
    return (
      <div
        className={`turn-progress ${isStopping ? 'turn-progress-stopping' : 'turn-progress-working'}`}
        data-testid={isStopping ? 'turn-progress-stopping' : 'turn-progress-working'}>
        <span className="progress-spinner">◐</span>
        <span>
          {isStopping ? 'Stopping' : 'Working'}
          <span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </div>
    )
  }

  const showTelemetry = !capabilities || capabilities.supports_cost_telemetry

  if (showTelemetry && duration !== null && !(hasPendingMessages && !hasNextUserMessage)) {
    return (
      <div className="turn-progress turn-progress-complete">
        <span>✓</span>
        <span>worked for {formatDuration(duration)}</span>
      </div>
    )
  }

  return null
}
