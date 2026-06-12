/** Split-button for creating new sessions - main button + chevron dropdown. */

import { ChevronDown, Loader2, Plus } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import useDropdown from '../hooks/useDropdown'
import useDropdownPosition from '../hooks/useDropdownPosition'
import useNewSession from '../hooks/useNewSession'

/**
 * Render a Plus + chevron split-button that creates new sessions.
 *
 * Click -> new session in current browser tab.
 * Alt-click / middle-click on the main button -> new session in new browser tab.
 * Chevron -> dropdown with "New session" / "New session in new browser tab".
 *
 * @param {Object} props
 * @param {'inline'|'portal'} [props.dropdownPlacement='inline'] - Where to render the dropdown.
 *   `inline` keeps the dropdown inside the wrapper span (suitable for the session header strip
 *   and other roomy containers). `portal` renders into document.body and positions via
 *   useDropdownPosition (suitable for tight containers like the SessionsPanel header).
 * @param {string} [props.dataTestIdPrefix='session'] - Prefix for the main button's data-testid.
 *   Becomes `${prefix}-new-session-btn`. Use `'header'` inside the session header strip and
 *   `'session'` inside the SessionsPanel.
 * @param {'accent'|'plain'} [props.hoverVariant='accent'] - Hover background treatment.
 *   `accent` picks up the workspace-accent tint (`var(--accent-hover, var(--bg-tertiary))`).
 *   `plain` uses `var(--bg-tertiary)` directly with no accent. Default `accent` matches the
 *   main-area-header instance; the SessionsPanel passes `plain` so its `+`/chevron align with
 *   the existing refresh button.
 * @param {string} [props.className] - Optional extra class on the wrapper for layout-specific styling.
 */
export default function NewSessionSplitButton({
  dropdownPlacement = 'inline',
  dataTestIdPrefix = 'session',
  hoverVariant = 'accent',
  className = '',
}) {
  const { executeNewSession, executeNewSessionInNewTab, isCreating, isCreatingInNewTab } =
    useNewSession()
  const busy = isCreating || isCreatingInNewTab
  const isPortal = dropdownPlacement === 'portal'

  const chevronRef = useRef(null)
  const { isOpen, setIsOpen, containerRef, handleToggle, handleKeyDown } = useDropdown(
    false,
    isPortal ? { triggerRef: chevronRef } : undefined,
  )
  const dropdownPos = useDropdownPosition({
    triggerRef: chevronRef,
    contentRef: containerRef,
    isOpen: isPortal && isOpen,
  })

  const handleNewSession = useCallback(
    e => {
      if (e?.altKey) {
        void executeNewSessionInNewTab()
        return
      }
      executeNewSession()
    },
    [executeNewSession, executeNewSessionInNewTab],
  )

  const handleAuxClick = useCallback(
    e => {
      if (e.button === 1) {
        e.preventDefault()
        void executeNewSessionInNewTab()
      }
    },
    [executeNewSessionInNewTab],
  )

  const handlePickCurrent = useCallback(() => {
    setIsOpen(false)
    executeNewSession()
  }, [executeNewSession, setIsOpen])

  const handlePickNewBrowserTab = useCallback(() => {
    setIsOpen(false)
    void executeNewSessionInNewTab()
  }, [executeNewSessionInNewTab, setIsOpen])

  const dropdownContent = isOpen ? (
    <div
      ref={isPortal ? containerRef : undefined}
      className={`dropdown-menu new-session-dropdown${isPortal ? ' new-session-dropdown-portal' : ''}`}
      style={isPortal ? { top: dropdownPos.top ?? 0, left: dropdownPos.left ?? 0 } : undefined}>
      <button type="button" className="dropdown-option" onClick={handlePickCurrent}>
        New session
      </button>
      <button type="button" className="dropdown-option" onClick={handlePickNewBrowserTab}>
        New session in new browser tab
      </button>
    </div>
  ) : null

  const buttonTestId = `${dataTestIdPrefix}-new-session-btn`

  return (
    <span
      className={`new-session-split new-session-split--${hoverVariant}${className ? ` ${className}` : ''}`}
      ref={isPortal ? undefined : containerRef}
      onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="new-session-split-btn"
        data-testid={buttonTestId}
        onClick={handleNewSession}
        onAuxClick={handleAuxClick}
        disabled={busy}
        title="New session (Alt+Click or middle-click for new browser tab)">
        {busy ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
      </button>
      <button
        ref={chevronRef}
        type="button"
        className="new-session-split-chevron"
        data-testid={`${dataTestIdPrefix}-new-session-chevron`}
        onClick={handleToggle}
        disabled={busy}
        title="More start options">
        <ChevronDown size={10} />
      </button>
      {isPortal && dropdownContent ? createPortal(dropdownContent, document.body) : dropdownContent}
    </span>
  )
}
