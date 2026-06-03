/** Render a queued or paused message bubble with send-now/edit/cancel/re-queue controls. */

import { memo } from 'react'
import { QueueStatus } from '../../../config/schema'
import UserMessageContent from './turn/components/user-message-content'

/**
 * Render a queued or paused message bubble with action buttons.
 * @param {object} props
 * @param {object} props.item - Queue item { id, content, attachments, status }
 * @param {function} props.onEdit - Called with item id to edit.
 * @param {function} props.onCancel - Called with item id to cancel.
 * @param {function} props.onRequeue - Called with item id to re-queue (paused items only).
 * @param {function} props.onSendNow - Called with item id to send immediately, skipping queue order.
 */
function QueuedMessageBubble({ item, onEdit, onCancel, onRequeue, onSendNow }) {
  const isPaused = item.status === QueueStatus.PAUSED

  return (
    <div
      className={`chat-message-user queued-message-bubble${isPaused ? ' paused' : ''}`}
      data-testid="queued-message-bubble">
      <UserMessageContent message={item.content} attachments={item.attachments} />
      <div className="queued-message-actions">
        {isPaused ? (
          <>
            <button type="button" onClick={() => onRequeue(item.id)} title="Re-queue">
              ▶
            </button>
            <button type="button" onClick={() => onCancel(item.id)} title="Cancel">
              ✕
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onSendNow(item.id)} title="Send now">
              ⇒
            </button>
            <button type="button" onClick={() => onEdit(item.id)} title="Edit">
              ✎
            </button>
            <button type="button" onClick={() => onCancel(item.id)} title="Cancel">
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default memo(QueuedMessageBubble)
