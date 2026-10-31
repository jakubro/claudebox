/** One-click replies an agent offers with its ask, shown last in its newest message. */

import { CornerRightDown } from 'lucide-react'
import { useState } from 'react'

/**
 * @param {string[]} props.replies - Labels, the first being the primary
 * @param {function(string): Promise<void>} props.onReply - Sends a label as the user's message
 * @param {function(string): void} [props.onEdit] - Puts a label in the message box; no arrows without it
 */
export default function NeedsUserReplies({ replies, onReply, onEdit }) {
  const [sending, setSending] = useState(false)

  const reply = async label => {
    setSending(true)
    try {
      await onReply(label)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="needs-user-replies" data-testid="needs-user-replies">
      {replies.map((label, i) => {
        const look = `needs-user-reply${i === 0 ? ' needs-user-reply-primary' : ''}`
        return (
          <span key={label} className="needs-user-reply-split">
            <button type="button" className={look} disabled={sending} onClick={() => reply(label)}>
              {label}
            </button>
            {onEdit && (
              <button
                type="button"
                className={`${look} needs-user-reply-edit`}
                title="Edit in message box"
                disabled={sending}
                onClick={() => onEdit(label)}>
                <CornerRightDown size={12} />
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}
