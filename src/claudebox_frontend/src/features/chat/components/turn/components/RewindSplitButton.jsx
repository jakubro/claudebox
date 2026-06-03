/** Split-button for rewind: main button rewinds here, chevron reveals rewind variants. */

import { ChevronDown, Loader2, RotateCcw } from 'lucide-react'
import useCapabilities from '../../../../../hooks/useCapabilities'
import useDropdown from '../../../../../hooks/useDropdown'

/**
 * Split-button for rewind: main button rewinds here, chevron reveals rewind variants.
 * @param {Object} props
 * @param {string} props.turnId - Turn identifier to rewind from.
 * @param {Function} props.onRewind - Callback receiving (turnId, mode).
 * @param {boolean} props.forking - Whether a fork is in progress.
 */
function RewindSplitButton({ turnId, onRewind, forking = false }) {
  const { capabilities } = useCapabilities()
  const { isOpen, setIsOpen, containerRef, handleToggle, handleKeyDown } = useDropdown(false)

  if (capabilities && !capabilities.supports_session_rewind) {
    return null
  }

  return (
    <span className="message-rewind-split" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="message-rewind-btn"
        title="Rewind to before this message (Alt+Click or middle-click for new browser tab)"
        disabled={forking}
        onClick={e => {
          if (e?.altKey) {
            onRewind(turnId, 'fork-browser-tab')
            return
          }
          onRewind(turnId, 'fork-here')
        }}
        onAuxClick={e => {
          if (e.button === 1) {
            e.preventDefault()
            onRewind(turnId, 'fork-browser-tab')
          }
        }}>
        {forking ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />}
      </button>
      <button
        type="button"
        className="message-rewind-chevron"
        title="Rewind options"
        disabled={forking}
        onClick={handleToggle}>
        <ChevronDown size={10} />
      </button>
      {isOpen && (
        <div className="dropdown-menu rewind-dropdown">
          <button
            type="button"
            className="dropdown-option"
            onClick={() => {
              setIsOpen(false)
              onRewind(turnId, 'fork-here')
            }}>
            Rewind here
          </button>
          <button
            type="button"
            className="dropdown-option"
            onClick={() => {
              setIsOpen(false)
              onRewind(turnId, 'fork-browser-tab')
            }}>
            Rewind in new browser tab
          </button>
        </div>
      )}
    </span>
  )
}

export default RewindSplitButton
