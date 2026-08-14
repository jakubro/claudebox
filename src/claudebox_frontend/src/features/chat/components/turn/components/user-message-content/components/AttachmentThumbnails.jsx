/** Render a horizontal row of attachment thumbnails with fullscreen zoom on click. */

import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { containerUrl } from '../../../../../../../api/apiClient'
import { formatFileSize } from '../../../../../../../utils/formatters'

/**
 * Supports two shapes: pending messages `{name, type, data}` (base64, rendered as a data URL)
 * and event-based `{name, type, size, filename}` (filename resolved via the API).
 * @param {Array<object>} props.attachments - Attachments in either data shape above.
 */
export default function AttachmentThumbnails({ attachments }) {
  const [zoomedSrc, setZoomedSrc] = useState(null)

  const handleZoomClose = useCallback(() => setZoomedSrc(null), [])

  const handleBackdropClick = useCallback(
    e => {
      if (e.target === e.currentTarget) {
        handleZoomClose()
      }
    },
    [handleZoomClose],
  )

  // Document-level Escape listener
  useEffect(() => {
    if (!zoomedSrc) {
      return
    }
    const onKeyDown = e => {
      if (e.key === 'Escape') {
        handleZoomClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [zoomedSrc, handleZoomClose])

  /** Resolve image source URL for an attachment. */
  function imgSrc(a) {
    return a.filename
      ? containerUrl(`/api/sessions/current/attachments/${a.filename}`)
      : `data:${a.type};base64,${a.data}`
  }

  return (
    <>
      <div className="message-attachments">
        {attachments.map((a, i) => (
          <div key={a.name + i} className="message-attachment-item" title={a.name}>
            {a.type?.startsWith('image/') ? (
              <img
                className="message-attachment-thumb"
                src={imgSrc(a)}
                alt={a.name}
                onClick={() => setZoomedSrc(imgSrc(a))}
              />
            ) : (
              <div className="message-attachment-file">
                <span className="message-attachment-ext">
                  {a.name?.includes('.') ? a.name.split('.').pop().toUpperCase() : 'FILE'}
                </span>
                <span className="message-attachment-name">{a.name}</span>
                {a.size != null && (
                  <span className="message-attachment-size">{formatFileSize(a.size)}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Portal the zoom overlay to body so it escapes the turn's containment (otherwise the fixed overlay is clipped to the turn box). */}
      {zoomedSrc &&
        createPortal(
          <div className="attachment-zoom-overlay" onClick={handleBackdropClick}>
            <button
              type="button"
              className="zoom-overlay-close"
              onClick={handleZoomClose}
              title="Close">
              <X size={20} />
            </button>
            <div className="attachment-zoom-content">
              <img src={zoomedSrc} alt="Attachment preview" />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
