/** Desktop notifications when Claude finishes responding. */

import { useCallback, useEffect, useRef } from 'react'
import { NOTIFICATION_BATCH_DELAY_MS } from '../../../config/timing'
import {
  buildNotificationTitle,
  getResponsePreview,
  playChime,
  requestNotificationPermission,
  setTitleIndicator,
} from '../utils/notifications'

/**
 * Manage desktop notifications for response completion.
 *
 * Sends browser notification when response completes and tab is not focused.
 * Updates tab title with indicator when it's user's turn.
 * Plays audio chime when sound is enabled.
 *
 * @param {object} options - Hook options
 * @param {boolean} options.isResponding - Whether Claude is currently responding
 * @param {boolean} [options.isReplaying] - Whether SSE history replay is in progress
 * @param {Array} options.events - SSE events array
 * @param {string} options.sessionName - Current session name
 * @param {string} options.workspace - Current workspace path
 * @param {boolean} options.notificationsEnabled - Whether notifications (sound + desktop) are enabled
 */
export default function useNotifications({
  isResponding,
  isReplaying = false,
  events,
  sessionName,
  workspace,
  notificationsEnabled,
}) {
  const wasRespondingRef = useRef(false)
  const permissionRequestedRef = useRef(false)
  const isInitialLoadRef = useRef(true)
  const userInteractedRef = useRef(false)
  const eventsRef = useRef(events)
  eventsRef.current = events

  // Request permission on first response (non-blocking)
  useEffect(() => {
    if (isResponding && !permissionRequestedRef.current) {
      permissionRequestedRef.current = true
      void requestNotificationPermission()
    }
  }, [isResponding])

  // Track user interaction to clear indicator
  useEffect(() => {
    const handleInteraction = () => {
      userInteractedRef.current = true
      setTitleIndicator(false)
    }

    // Clear indicator on any user interaction
    window.addEventListener('focus', handleInteraction)
    window.addEventListener('click', handleInteraction)
    window.addEventListener('keydown', handleInteraction)

    return () => {
      window.removeEventListener('focus', handleInteraction)
      window.removeEventListener('click', handleInteraction)
      window.removeEventListener('keydown', handleInteraction)
    }
  }, [])

  // Mark initial load complete after first real-time responding state.
  // Replay-driven responding=true does not count — those events reflect
  // historical activity, not the current user-facing turn.
  useEffect(() => {
    if (isResponding && !isReplaying) {
      isInitialLoadRef.current = false
    }
  }, [isResponding, isReplaying])

  // Track transition from responding to not responding
  useEffect(() => {
    const wasResponding = wasRespondingRef.current
    wasRespondingRef.current = isResponding

    // Check for completion transition
    if (wasResponding && !isResponding) {
      // Skip both indicator and notification on session resume — the responding
      // transition during SSE replay is not an actual user-facing completion.
      // Replay-time transitions are also caught by isReplaying since the
      // result event arrives before replay_ended fires.
      if (isInitialLoadRef.current || isReplaying) {
        return
      }

      // Reset user interaction flag - they need to interact again
      userInteractedRef.current = false

      // Add tab title indicator (user's turn)
      setTitleIndicator(true)

      // Only notify if tab is hidden and notifications enabled
      if (document.hidden && notificationsEnabled) {
        // Play sound chime
        playChime()

        // Show desktop notification if permission granted
        // Delay to allow pendingBatch flush (~50ms) so events contain assistant text
        if (Notification.permission === 'granted') {
          setTimeout(() => {
            const preview = getResponsePreview(eventsRef.current)
            const title = buildNotificationTitle(sessionName, workspace)
            const notification = new Notification(title, {
              body: preview,
              icon: '/favicon.ico',
              tag: 'claude-response', // Prevents duplicate notifications
            })

            // Focus window when clicked
            notification.onclick = () => {
              window.focus()
              notification.close()
            }
          }, NOTIFICATION_BATCH_DELAY_MS)
        }
      }
    }
  }, [isResponding, isReplaying, sessionName, workspace, notificationsEnabled])

  // Manual permission request
  const requestPermission = useCallback(async () => {
    return requestNotificationPermission()
  }, [])

  return { requestPermission }
}
