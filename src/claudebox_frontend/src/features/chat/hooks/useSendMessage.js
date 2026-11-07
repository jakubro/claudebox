/** Shared send-with-error-handling callback for chat submissions. */

import { useCallback } from 'react'
import { ContainerGoneError, sendMessage } from '../../../api/chat'
import { sameOwner } from '../../../utils/pickBuffer'
import { preserveInput } from '../utils/preservedInput'

/**
 * @param {object} deps
 * @param {function} deps.submitSucceeded - Marks send done; the assistant reply arrives separately.
 * @param {function} [deps.onContainerGone] - Fires when the container is gone; triggers session recovery.
 * @param {function} deps.ownerNow - Owner tag of the session a send belongs to.
 * @returns {function(string, object=): Promise<boolean>} Resolves true only if the message arrived -
 *   callers hold their copy of what they sent until this says so.
 */
export default function useSendMessage({
  addPendingMessage,
  removePendingMessage,
  startSubmitting,
  submitSucceeded,
  submitFailed,
  setError,
  onContainerGone,
  ownerNow,
}) {
  return useCallback(
    async (
      content,
      { attachments = null, inlineReplies = null, note = null, target, sentAt = Date.now() } = {},
    ) => {
      const messageId = addPendingMessage?.(content, attachments, inlineReplies, note, sentAt)
      // Fixed before the await: the session on screen may be another one by the time it fails.
      const owner = ownerNow()
      startSubmitting()
      try {
        await sendMessage(content, { attachments, inlineReplies, note, target })
        submitSucceeded()
        return true
      } catch (err) {
        if (messageId) {
          removePendingMessage?.(messageId)
        }
        submitFailed()
        if (err instanceof ContainerGoneError) {
          // A form answer or reply restores what the user typed beside it, never its own label
          const typed = note === null ? content : note
          if (typed) {
            preserveInput(owner, typed)
          }
          if (sameOwner(ownerNow(), owner)) {
            setError('Connection lost - retrying. Your message is preserved.')
          }
          onContainerGone?.()
        } else {
          setError('Send failed')
        }
        return false
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
      ownerNow,
    ],
  )
}
