/** Fullscreen zoom overlay shell - dark backdrop, close button, and caller-supplied content. */

import { X } from 'lucide-react'

/**
 * @param {() => void} props.onBackdropClick - Fired on a click outside the content.
 */
export default function ZoomOverlay({ onBackdropClick, onClose, children }) {
  return (
    <div className="zoom-overlay" onClick={onBackdropClick}>
      <button type="button" className="zoom-overlay-close" onClick={onClose} title="Close">
        <X size={20} />
      </button>
      {children}
    </div>
  )
}
