/** Passive toast surfaced when the user navigates away from a still-responding session. */

import { useEffect } from 'react'
import { STILL_RUNNING_TOAST_DISMISS_MS } from '../../../config/timing'

/**
 * Render a non-blocking toast confirming the prior session is still running in the background.
 * Click anywhere on the toast to navigate back. Auto-dismisses after a fixed delay.
 *
 * @param {object} props
 * @param {string} props.previousSessionName - Display name (or short id) of the prior session.
 * @param {Function} props.onReturn - Callback fired when the user clicks the toast.
 * @param {Function} props.onDismiss - Callback fired when the toast auto-dismisses.
 */
export default function StillRunningToast({ previousSessionName, onReturn, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, STILL_RUNNING_TOAST_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <button
      type="button"
      className="still-running-toast"
      onClick={onReturn}
      data-testid="still-running-toast">
      <span className="still-running-toast-text">
        Session <strong>{previousSessionName}</strong> still running
      </span>
      <span className="still-running-toast-cta">click to return</span>
    </button>
  )
}
