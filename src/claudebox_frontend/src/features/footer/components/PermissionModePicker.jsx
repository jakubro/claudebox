/** Permission mode picker dropdown for switching permission mode at runtime. */

import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSessionActions, useSessionData } from '../../../context/SessionDataContext'
import useCapabilities from '../../../hooks/useCapabilities'
import useDropdown from '../../../hooks/useDropdown'

/**
 * Render a footer dropdown for selecting the active permission mode.
 *
 * Receives current permission mode and available modes from session data (via context).
 * Optimistically updates on selection; confirmed by next SSE event.
 * On welcome (no active session), `defaultValue` populates the display so
 * the picker shows what a new session would inherit.
 *
 * @param {object} props
 * @param {string} props.currentPermissionMode - Active permission mode ID from session data.
 * @param {string|null} [props.defaultValue] - Default mode used when no active session value.
 * @param {boolean} props.disabled - True when picker should not open (e.g., during response).
 */
export default function PermissionModePicker({ currentPermissionMode, defaultValue, disabled }) {
  const { capabilities } = useCapabilities()
  const { availablePermissionModes } = useSessionData()
  const { setPermissionMode } = useSessionActions()
  const { isOpen, setIsOpen, containerRef, handleToggle, handleKeyDown } = useDropdown(disabled)
  const [optimisticMode, setOptimisticMode] = useState(null)

  // Clear optimistic override when session data confirms the change
  useEffect(() => {
    if (currentPermissionMode && optimisticMode && currentPermissionMode === optimisticMode) {
      setOptimisticMode(null)
    }
  }, [currentPermissionMode, optimisticMode])

  const effectiveMode = optimisticMode || currentPermissionMode || defaultValue

  const handleSelect = useCallback(
    modeId => {
      setIsOpen(false)
      if (modeId !== effectiveMode) {
        setOptimisticMode(modeId)
        setPermissionMode(modeId)
      }
    },
    [effectiveMode, setPermissionMode, setIsOpen],
  )

  if (
    capabilities &&
    !(capabilities.supports_permission_modes && capabilities.supports_set_permission_mode)
  ) {
    return null
  }

  const activePermissionMode = availablePermissionModes.find(m => m.id === effectiveMode)
  const displayName = activePermissionMode?.name || effectiveMode || '—'
  const displayDescription = activePermissionMode?.description || displayName

  return (
    <span
      className="footer-picker footer-permission-mode-picker"
      ref={containerRef}
      onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="footer-picker-btn footer-permission-mode-btn"
        disabled={disabled}
        onClick={handleToggle}
        title={`Permission mode — ${displayDescription}`}
        data-testid="footer-permission-mode-picker"
        data-permission-mode={effectiveMode || ''}>
        {displayName}
        <ChevronDown size={10} />
      </button>
      {isOpen && (
        <div
          className="footer-picker-dropdown footer-permission-mode-dropdown"
          data-testid="permission-mode-dropdown">
          {availablePermissionModes.map(m => (
            <button
              key={m.id}
              type="button"
              className={`dropdown-option footer-dropdown-option footer-permission-mode-option${m.id === effectiveMode ? ' selected' : ''}`}
              onClick={() => handleSelect(m.id)}>
              <span className="footer-dropdown-check footer-permission-mode-option-check">
                {m.id === effectiveMode && <Check size={12} />}
              </span>
              <span className="footer-dropdown-name footer-permission-mode-option-name">
                {m.name}
              </span>
              {m.description && (
                <span className="footer-permission-mode-option-desc">{m.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
