/** Progress overlay shown over the transcript while a session is created, resumed or replayed. */

/**
 * @param {boolean} props.isCreating - A new session: the bar runs indeterminate instead of filling.
 */
export default function ReplayOverlay({ isCreating, replayProgress, replayTotal, statusText }) {
  return (
    <div className="chat-replay-overlay">
      <div className={`chat-replay-progress-bar${isCreating ? ' indeterminate' : ''}`}>
        {!isCreating && (
          <div
            className="chat-replay-progress-fill"
            style={{
              // Clamped: live events drain through this queue, outside replayTotal.
              width: `${replayTotal > 0 ? Math.min(100, (replayProgress / replayTotal) * 100) : 0}%`,
            }}
          />
        )}
      </div>
      {statusText && <p className="chat-replay-status-text">{statusText}</p>}
    </div>
  )
}
