/** Horizontal preview row of pending attachments with remove buttons. */

import { X } from 'lucide-react'

/**
 * Render a row of attachment thumbnails below the textarea.
 * @param {object} props
 * @param {Array} props.attachments - Array of {id, name, type, data, size}.
 * @param {Function} props.onRemove - Called with attachment id to remove.
 */
export default function AttachmentPreview({ attachments, onRemove }) {
  if (!attachments || attachments.length === 0) {
    return null
  }

  return (
    <div className="attachment-preview" data-testid="attachment-preview">
      {attachments.map(a => (
        <div key={a.id} className="attachment-item" title={a.name}>
          {a.type.startsWith('image/') ? (
            <img
              className="attachment-thumb"
              src={`data:${a.type};base64,${a.data}`}
              alt={a.name}
            />
          ) : (
            <div className="attachment-file-icon">
              <span className="attachment-ext">
                {a.name.includes('.') ? a.name.split('.').pop().toUpperCase() : 'FILE'}
              </span>
            </div>
          )}
          <span className="attachment-name">{a.name}</span>
          <button
            type="button"
            className="attachment-remove"
            onClick={() => onRemove(a.id)}
            title="Remove attachment">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
