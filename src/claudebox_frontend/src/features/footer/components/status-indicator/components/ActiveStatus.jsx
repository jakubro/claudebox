/** Animated status with pulsing dot, elapsed timer, and silence detection. */

import { useEffect, useRef, useState } from 'react'
import { SILENCE_THRESHOLD } from '../../../../../config/timing'
import useTurnClock from '../../../../../hooks/useTurnClock'
import { formatDurationCompact } from '../../../../../utils/formatters'

/**
 * @param {object} props
 * @param {string} props.label - Status label text (e.g., "Working", "Submitting").
 * @param {string} props.status - Status key for data attribute.
 * @param {number|null} [props.runningSince] - When the running turn started; with none, the timer
 *   counts from when this status appeared.
 * @param {number|null} [props.lastEventTimestamp] - Timestamp of last received event for silence detection.
 */
export default function ActiveStatus({ label, status, runningSince, lastEventTimestamp }) {
  const fallbackRef = useRef(Date.now())
  const anchorTimestamp = runningSince ?? fallbackRef.current
  const now = useTurnClock(anchorTimestamp)
  const elapsed = Math.floor((now - anchorTimestamp) / 1000)
  const [isSilent, setIsSilent] = useState(false)

  // Event-driven, not polled: recomputes on lastEventTimestamp change (no up-to-1s lag) and
  // schedules a one-shot timer for the exact moment silence begins.
  useEffect(() => {
    if (!lastEventTimestamp) {
      return
    }
    const sinceLastEvent = Date.now() - lastEventTimestamp
    if (sinceLastEvent >= SILENCE_THRESHOLD) {
      setIsSilent(true)
      return
    }
    setIsSilent(false)
    const tripTimer = setTimeout(() => setIsSilent(true), SILENCE_THRESHOLD - sinceLastEvent)
    return () => clearTimeout(tripTimer)
  }, [lastEventTimestamp])

  return (
    <>
      <span
        className={`status-dot status-connected status-working${isSilent ? ' status-silent' : ''}`}
        data-testid="footer-status"
        data-status={status}
      />
      <span className="footer-item footer-status-text">
        {label}
        <span className="dot dot-1">.</span>
        <span className="dot dot-2">.</span>
        <span className="dot dot-3">.</span>
        {elapsed > 0 && <span className="footer-elapsed"> ({formatDurationCompact(elapsed)})</span>}
      </span>
      <span className="footer-interrupt">Ctrl+. to stop</span>
    </>
  )
}
