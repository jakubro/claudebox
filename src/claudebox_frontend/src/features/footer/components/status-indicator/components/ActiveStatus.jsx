/** Animated status with pulsing dot, elapsed timer, and silence detection. */

import { useEffect, useRef, useState } from 'react'
import { SILENCE_THRESHOLD } from '../../../../../config/timing'
import { formatDurationCompact } from '../../../../../utils/formatters'

/**
 * Render animated status indicator with elapsed timer and silence detection.
 *
 * @param {object} props
 * @param {string} props.label - Status label text (e.g., "Working", "Submitting").
 * @param {string} props.status - Status key for data attribute.
 * @param {number|null} [props.respondingSince] - Timestamp when response started, for elapsed timer.
 * @param {number|null} [props.lastEventTimestamp] - Timestamp of last received event for silence detection.
 */
export default function ActiveStatus({ label, status, respondingSince, lastEventTimestamp }) {
  const fallbackRef = useRef(Date.now())
  const anchorTimestamp = respondingSince ?? fallbackRef.current
  const [elapsed, setElapsed] = useState(0)
  const [isSilent, setIsSilent] = useState(false)

  useEffect(() => {
    // Elapsed timer ticks every second — runs continuously while mounted.
    const elapsedInterval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - anchorTimestamp) / 1000))
    }, 1000)

    // Silence detection — event-driven, not polled. Recompute immediately
    // whenever lastEventTimestamp changes so recovery from "Waiting" → label
    // happens the moment a new event arrives (no up-to-one-second polling
    // lag). When still within the threshold, schedule a one-shot trip timer
    // for the exact moment silence begins.
    let tripTimer = null
    if (lastEventTimestamp) {
      const sinceLastEvent = Date.now() - lastEventTimestamp
      if (sinceLastEvent >= SILENCE_THRESHOLD) {
        setIsSilent(true)
      } else {
        setIsSilent(false)
        tripTimer = setTimeout(() => setIsSilent(true), SILENCE_THRESHOLD - sinceLastEvent)
      }
    }

    return () => {
      clearInterval(elapsedInterval)
      if (tripTimer) {
        clearTimeout(tripTimer)
      }
    }
  }, [anchorTimestamp, lastEventTimestamp])

  const displayLabel = isSilent ? 'Waiting' : label

  return (
    <>
      <span
        className={`status-dot status-connected status-working${isSilent ? ' status-silent' : ''}`}
        data-testid="footer-status"
        data-status={status}
      />
      <span className={`footer-item footer-status-text${isSilent ? ' status-silent' : ''}`}>
        {displayLabel}
        <span className="dot dot-1">.</span>
        <span className="dot dot-2">.</span>
        <span className="dot dot-3">.</span>
        {elapsed > 0 && <span className="footer-elapsed"> ({formatDurationCompact(elapsed)})</span>}
      </span>
      <span className="footer-interrupt">Ctrl+. to stop</span>
    </>
  )
}
