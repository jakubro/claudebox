/** Shared Play+chevron split-button used by SessionItem + ContainerRow. */

import { ChevronDown, Loader2, Play } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useDropdown from '../hooks/useDropdown'
import useDropdownPosition from '../hooks/useDropdownPosition'

/**
 * Render the resume split-button: Play (current tab), chevron (dropdown with
 * "Open session" / "Open in new browser tab"). Click Play with Alt or
 * middle-click also opens in a new tab.
 *
 * @param {object} props
 * @param {() => void} props.onResume - Called for in-tab resume.
 * @param {() => void} props.onOpenInNewTab - Called for new-tab resume.
 * @param {boolean} [props.disabled] - Disable both Play and chevron.
 * @param {boolean} [props.isLoading] - Show spinner instead of Play while pending.
 * @param {string} [props.title] - Tooltip on the Play button.
 */
export default function ResumeControl({
  onResume,
  onOpenInNewTab,
  disabled = false,
  isLoading: externalLoading = false,
  title = 'Resume session (Alt+Click or middle-click for new browser tab)',
}) {
  const chevronRef = useRef(null)
  const {
    isOpen,
    setIsOpen,
    containerRef: menuRef,
    handleToggle,
    handleKeyDown,
  } = useDropdown(false, { triggerRef: chevronRef })
  const menuPos = useDropdownPosition({ triggerRef: chevronRef, isOpen })
  const [localSpinner, setLocalSpinner] = useState(false)

  const handleWithSpinner = useCallback(action => {
    setLocalSpinner(true)
    setTimeout(() => setLocalSpinner(false), 500)
    action()
  }, [])

  const showSpinner = externalLoading || localSpinner

  return (
    <span className="sessions-resume-split" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="sessions-resume-btn"
        data-testid="session-resume-btn"
        disabled={disabled}
        onClick={e => {
          if (e?.altKey) {
            handleWithSpinner(() => onOpenInNewTab())
            return
          }
          handleWithSpinner(() => onResume())
        }}
        onAuxClick={e => {
          if (e.button === 1) {
            e.preventDefault()
            handleWithSpinner(() => onOpenInNewTab())
          }
        }}
        title={title}>
        {showSpinner ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
      </button>
      <button
        ref={chevronRef}
        type="button"
        className="sessions-resume-chevron"
        onClick={handleToggle}
        disabled={disabled}
        title="More resume options">
        <ChevronDown size={10} />
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu sessions-resume-dropdown"
            style={{
              top: menuPos.top ?? 0,
              left: menuPos.left ?? 0,
            }}>
            <button
              type="button"
              className="dropdown-option"
              onClick={() => {
                setIsOpen(false)
                handleWithSpinner(() => onResume())
              }}>
              Open session
            </button>
            <button
              type="button"
              className="dropdown-option"
              onClick={() => {
                setIsOpen(false)
                handleWithSpinner(() => onOpenInNewTab())
              }}>
              Open in new browser tab
            </button>
          </div>,
          document.body,
        )}
    </span>
  )
}
