/** Shared send-with-error-handling callback for chat submissions. */

import { useCallback } from 'react'
import { ContainerGoneError, sendMessage } from '../../../api/chat'

/**
 * @param {object} deps
 * @param {function} deps.submitSucceeded - Marks send done; the assistant reply arrives separately.
 * @param {function} [deps.onContainerGone] - Fires when the container is gone; triggers session recovery.
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
    async (content, { attachments = null, inlineReplies = null, note = null } = {}) => {
      const messageId = addPendingMessage?.(content, attachments, inlineReplies, note)
      startSubmitting()
      try {
        await sendMessage(content, { attachments, inlineReplies, note })
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
