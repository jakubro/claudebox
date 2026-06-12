/** Resume button + chevron dropdown - extracted so its hooks don't run for mobile/current rows. */

import { ChevronDown, Loader2, Play } from 'lucide-react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import useDropdown from '../../../../../hooks/useDropdown'
import useDropdownPosition from '../../../../../hooks/useDropdownPosition'

/**
 * Render the desktop-only "Resume session" split button - primary action +
 * chevron menu. Extracted from SessionItem so the useDropdown and
 * useDropdownPosition hooks (state, refs, effects) do not allocate for
 * sessions that can never open this dropdown - mobile rows and the active
 * (current) session.
 *
 * @param {object} props
 * @param {boolean} props.isResuming - Spinner-state flag from the parent's flashStatus cycle.
 * @param {function} props.onResume - Resume callback.
 * @param {function} props.onOpenInNewTab - Open-in-new-tab callback.
 * @param {function} props.onResumeWithSpinner - Wrap an action with the spinner flash.
 */
export default function ResumeSplitButton({
  isResuming,
  onResume,
  onOpenInNewTab,
  onResumeWithSpinner,
}) {
  const chevronRef = useRef(null)
  const {
    isOpen: isResumeMenuOpen,
    setIsOpen: setResumeMenuOpen,
    containerRef: resumeMenuRef,
    handleToggle: toggleResumeMenu,
    handleKeyDown: resumeMenuKeyDown,
  } = useDropdown(false, { triggerRef: chevronRef })
  const resumeMenuPos = useDropdownPosition({
    triggerRef: chevronRef,
    contentRef: resumeMenuRef,
    isOpen: isResumeMenuOpen,
  })

  return (
    <span className="sessions-resume-split" onKeyDown={resumeMenuKeyDown}>
      <button
        type="button"
        className="sessions-resume-btn"
        data-testid="session-resume-btn"
        disabled={isResuming}
        onClick={e => {
          if (e?.altKey) {
            onResumeWithSpinner(() => onOpenInNewTab())
            return
          }
          onResumeWithSpinner(() => onResume())
        }}
        onAuxClick={e => {
          if (e.button === 1) {
            e.preventDefault()
            onResumeWithSpinner(() => onOpenInNewTab())
          }
        }}
        title="Resume session (Alt+Click or middle-click for new browser tab)">
        {isResuming ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
      </button>
      <button
        ref={chevronRef}
        type="button"
        className="sessions-resume-chevron"
        onClick={toggleResumeMenu}
        title="More resume options">
        <ChevronDown size={10} />
      </button>
      {isResumeMenuOpen &&
        createPortal(
          <div
            ref={resumeMenuRef}
            className="dropdown-menu sessions-resume-dropdown"
            style={{
              top: resumeMenuPos.top ?? 0,
              left: resumeMenuPos.left ?? 0,
            }}>
            <button
              type="button"
              className="dropdown-option"
              onClick={() => {
                setResumeMenuOpen(false)
                onResumeWithSpinner(() => onResume())
              }}>
              Resume session
            </button>
            <button
              type="button"
              className="dropdown-option"
              onClick={() => {
                setResumeMenuOpen(false)
                onResumeWithSpinner(() => onOpenInNewTab())
              }}>
              Resume in new browser tab
            </button>
          </div>,
          document.body,
        )}
    </span>
  )
}
