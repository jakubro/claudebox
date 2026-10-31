/** Turn progress indicator showing working, stopping, waiting on background work, or completion. */

// audit-ignore-file: excessive-props

import { Loader2 } from 'lucide-react'
import useCapabilities from '../../../../../hooks/useCapabilities'
import { formatDuration } from '../../../../../utils/formatters'

export default function TurnProgress({
  isActive,
  isStopping,
  showProgress,
  hasActiveCompaction,
  pending,
  awaitsQueuedMessage,
  duration,
  endTime = null,
  waitingOn = null,
  label = null,
  failed = false,
  children = null,
}) {
  const { capabilities } = useCapabilities()
  const compactionVisible =
    hasActiveCompaction && (!capabilities || capabilities.supports_pre_compact_hook)

  // For pending turns during compaction, show compaction spinner instead of "Working..."
  if (compactionVisible && pending) {
    return (
      <div className="turn-progress turn-progress-working" data-testid="turn-progress-working">
        <Loader2 size={13} className="progress-spinner" />
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
    return <AnswerRow>{children}</AnswerRow>
  }

  if (isActive || showProgress || isStopping) {
    return (
      <div
        className={`turn-progress ${isStopping ? 'turn-progress-stopping' : 'turn-progress-working'}`}
        data-testid={isStopping ? 'turn-progress-stopping' : 'turn-progress-working'}>
        <Loader2 size={13} className="progress-spinner" />
        <span className="turn-progress-text">
          <span className="turn-progress-label">
            {isStopping ? 'Stopping' : (label ?? 'Working')}
          </span>
          <span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
      </div>
    )
  }

  if (waitingOn?.length > 0 && !awaitsQueuedMessage) {
    const waitingLabel =
      waitingOn.length === 1
        ? `Waiting on ${waitingOn[0].name.split('\n')[0]}`
        : `Waiting on ${waitingOn.length} background tasks`
    return (
      <div className="turn-progress turn-progress-waiting" data-testid="turn-progress-waiting">
        <Loader2 size={13} className="progress-spinner" />
        <span className="turn-progress-label">{waitingLabel}</span>
        <span className="turn-progress-dots">
          <span className="dot dot-1">.</span>
          <span className="dot dot-2">.</span>
          <span className="dot dot-3">.</span>
        </span>
        {children}
      </div>
    )
  }

  const showTelemetry = !capabilities || capabilities.supports_cost_telemetry

  if (showTelemetry && duration !== null && !awaitsQueuedMessage) {
    return (
      <div className="turn-progress turn-progress-complete">
        <span>{failed ? '✗' : '✓'}</span>
        <span title={endTime === null ? undefined : new Date(endTime).toLocaleString()}>
          worked for {formatDuration(duration)}
        </span>
        {children}
      </div>
    )
  }

  return <AnswerRow>{children}</AnswerRow>
}

function AnswerRow({ children }) {
  return children ? <div className="turn-progress turn-progress-complete">{children}</div> : null
}
