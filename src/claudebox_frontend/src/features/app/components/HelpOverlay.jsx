/** Full-screen overlay displaying the help panel. */

import HelpPanel from '../../help/HelpPanel'

/**
 * @param {object} props
 * @param {Function} props.onClose - Callback to close the overlay.
 */
export default function HelpOverlay({ onClose }) {
  return (
    <div
      className="help-overlay"
      onClick={() => {
        onClose()
        document.querySelector('.chat-input textarea')?.focus()
      }}>
      <div className="help-overlay-modal" onClick={e => e.stopPropagation()}>
        <HelpPanel />
      </div>
    </div>
  )
}
