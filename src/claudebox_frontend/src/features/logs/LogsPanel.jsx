/** Container API logs panel with auto-scroll, consuming provider-scoped SSE stream. */

import { useCallback, useEffect, useRef } from 'react'
import { AUTOSCROLL_THRESHOLD } from '../../config/dimensions'
import { useLogsStream } from '../../context/LogsStreamContext'
import { formatTimestamp } from '../../utils/formatters'
import { flattenExtras, formatPillValue } from './utils/extras'

/** Render container API logs panel with auto-scroll. */
export default function LogsPanel() {
  const {
    logs,
    isLogsReplaying,
    connectionStatus,
    isResuming,
    isSessionReplaying,
    containerId,
    clearUnreadErrors,
  } = useLogsStream()

  const scrollRef = useRef(null)
  const isAutoScrollEnabled = useRef(true)
  const isProgrammaticScroll = useRef(false)

  const isConnected = connectionStatus === 'connected'

  // Clear error badge when panel is opened
  // biome-ignore lint/correctness/useExhaustiveDependencies: only clear on mount
  useEffect(() => {
    clearUnreadErrors()
  }, [])

  // Auto-scroll to bottom on new logs
  // biome-ignore lint/correctness/useExhaustiveDependencies: logs triggers scroll on new entries
  useEffect(() => {
    if (isAutoScrollEnabled.current && scrollRef.current && !isLogsReplaying) {
      isProgrammaticScroll.current = true
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      requestAnimationFrame(() => {
        isProgrammaticScroll.current = false
      })
    }
  }, [logs, isLogsReplaying])

  // Scroll handler to detect user scroll
  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current || !scrollRef.current) {
      return
    }
    const { scrollHeight, scrollTop, clientHeight } = scrollRef.current
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    isAutoScrollEnabled.current = distanceFromBottom <= AUTOSCROLL_THRESHOLD
  }, [])

  if (!containerId) {
    return (
      <div className="logs-panel logs-empty" data-testid="panel-logs">
        No active session
      </div>
    )
  }

  if (isResuming || isSessionReplaying) {
    return (
      <div className="logs-panel logs-loading" data-testid="panel-logs">
        Resuming...
      </div>
    )
  }

  if (isLogsReplaying) {
    return (
      <div className="logs-panel logs-loading" data-testid="panel-logs">
        Loading logs...
      </div>
    )
  }

  if (logs.length === 0) {
    if (isConnected) {
      return (
        <div className="logs-panel logs-empty" data-testid="panel-logs">
          No logs yet
        </div>
      )
    }
    return (
      <div className="logs-panel logs-loading" data-testid="panel-logs">
        Connecting...
      </div>
    )
  }

  return (
    <div className="logs-panel" data-testid="panel-logs" ref={scrollRef} onScroll={handleScroll}>
      {logs.map((log, index) => {
        const pills = renderExtraPills(log.extra)
        const traceback = log.extra?.exception ?? null
        return (
          <div className="log-line" key={index}>
            <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
            <span className={`log-level log-level-${log.level.toLowerCase()}`}>{log.level}</span>
            <span className="log-logger">{log.logger}</span>
            <span className="log-message">{log.message}</span>
            {pills}
            {traceback && <pre className="log-traceback">{traceback}</pre>}
          </div>
        )
      })}
    </div>
  )
}

/** Render the flattened extras for a log line as inline pills, or null if none. */
function renderExtraPills(extra) {
  const pairs = flattenExtras(extra)
  if (pairs.length === 0) {
    return null
  }
  return pairs.map(({ key, value }) => <Pill key={key} k={key} v={value} />)
}

/**
 * Render a single key=value pill with type-aware value formatting.
 * @param {object} props
 * @param {string} props.k - Pill key (extras path; may include a one-level prefix like `session.id`).
 * @param {unknown} props.v - Pill value (any JSON-serializable type).
 */
function Pill({ k, v }) {
  const value = formatPillValue(v)
  return (
    <span className="log-extra-pill">
      <span className="log-extra-key">{k}</span>
      <span className="log-extra-sep">=</span>
      <span className="log-extra-value" title={value.length > 80 ? value : undefined}>
        {value.length > 80 ? `${value.slice(0, 80)}…` : value}
      </span>
    </span>
  )
}
