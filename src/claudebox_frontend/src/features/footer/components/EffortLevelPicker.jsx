/** Effort level picker dropdown for switching reasoning effort at runtime. */

import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSessionActions, useSessionData } from '../../../context/SessionDataContext'
import useCapabilities from '../../../hooks/useCapabilities'
import useDropdown from '../../../hooks/useDropdown'

/**
 * Render a footer dropdown for selecting the effort level.
 *
 * Available levels come from SessionDataContext (fetched once on connect).
 * All values shown on all models - the SDK handles compatibility.
 *
 * Optimistically updates on selection; confirmed by next session refresh.
 * On welcome (no active session), `defaultValue` populates the display so
 * the picker shows what a new session would inherit.
 *
 * @param {object} props
 * @param {string|null} props.currentEffortLevel - Currently active effort level.
 * @param {string|null} [props.defaultValue] - Default level used when no active session value.
 * @param {boolean} props.disabled - True when picker should not open.
 */
export default function EffortLevelPicker({ currentEffortLevel, defaultValue, disabled }) {
  const { capabilities } = useCapabilities()
  const { availableEffortLevels } = useSessionData()
  const { setEffortLevel } = useSessionActions()
  const { isOpen, setIsOpen, containerRef, handleToggle, handleKeyDown } = useDropdown(disabled)
  const [optimisticLevel, setOptimisticLevel] = useState(null)

  // Clear optimistic override when session data confirms the change
  useEffect(() => {
    if (currentEffortLevel && optimisticLevel && currentEffortLevel === optimisticLevel) {
      setOptimisticLevel(null)
    }
  }, [currentEffortLevel, optimisticLevel])

  const effectiveLevel = optimisticLevel || currentEffortLevel || defaultValue

  const handleSelect = useCallback(
    levelId => {
      setIsOpen(false)
      if (levelId !== effectiveLevel) {
        setOptimisticLevel(levelId)
        setEffortLevel(levelId)
      }
    },
    [effectiveLevel, setEffortLevel, setIsOpen],
  )

  if (
    capabilities &&
    !(capabilities.supports_effort_levels && capabilities.supports_set_effort_level)
  ) {
    return null
  }

  const displayName =
    availableEffortLevels.find(l => l.id === effectiveLevel)?.name || effectiveLevel || '-'

  return (
    <span className="footer-picker" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="footer-picker-btn"
        disabled={disabled}
        onClick={handleToggle}
        title={`Effort - ${effectiveLevel || '-'}`}
        data-testid="footer-effort">
        {displayName}
        <ChevronDown size={10} />
      </button>
      {isOpen && (
        <div
          className="footer-picker-dropdown footer-effort-dropdown"
          data-testid="effort-dropdown">
          {availableEffortLevels.map(l => (
            <button
              key={l.id}
              type="button"
              className={`dropdown-option footer-dropdown-option footer-effort-option${l.id === effectiveLevel ? ' selected' : ''}`}
              onClick={() => handleSelect(l.id)}>
              <span className="footer-dropdown-check footer-effort-option-check">
                {l.id === effectiveLevel && <Check size={12} />}
              </span>
              <span className="footer-dropdown-name footer-effort-option-name">{l.name}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
