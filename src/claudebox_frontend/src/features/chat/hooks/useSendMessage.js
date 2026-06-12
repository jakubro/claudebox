/** Shared send-with-error-handling callback for chat submissions. */

import { useCallback } from 'react'
import { ContainerGoneError, sendMessage } from '../../../api/chat'

/**
 * Create a reusable send callback that handles pending messages and interaction state.
 * @param {object} deps
 * @param {function} deps.addPendingMessage - Add optimistic pending message.
 * @param {function} deps.removePendingMessage - Remove pending message on error.
 * @param {function} deps.startSubmitting - Transition to submitting state.
 * @param {function} deps.submitSucceeded - Transition to awaiting response.
 * @param {function} deps.submitFailed - Transition out of submitting on error.
 * @param {function} deps.setError - Display error message.
 * @param {function} [deps.onContainerGone] - Called when container no longer exists (triggers session recovery).
 */
export default function useSendMessage({
  addPendingMessage,
  removePendingMessage,
  startSubmitting,
  submitSucceeded,
  submitFailed,
  setError,
  onContainerGone,
}) {
  return useCallback(
    async (content, attachments = null) => {
      const messageId = addPendingMessage?.(content, attachments)
      startSubmitting()
      try {
        await sendMessage(content, attachments)
        submitSucceeded()
      } catch (err) {
        if (messageId) {
          removePendingMessage?.(messageId)
        }
        submitFailed()
        if (err instanceof ContainerGoneError) {
          // Preserve user's message text for restoration after recovery
          if (content) {
            sessionStorage.setItem('_cb_preserved_input', content)
          }
          setError('Connection lost - retrying. Your message is preserved.')
          onContainerGone?.()
        } else {
          setError('Send failed')
        }
      }
    },
    [
      addPendingMessage,
      removePendingMessage,
      startSubmitting,
      submitSucceeded,
      submitFailed,
      setError,
      onContainerGone,
    ],
  )
}
