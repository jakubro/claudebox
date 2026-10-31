/** Welcome-screen picker choosing the settings bundle the next session starts under. */

import { Check, ChevronDown } from 'lucide-react'
import { useCallback } from 'react'
import { useSessionActions, useSessionData } from '../../../context/SessionDataContext'
import useDropdown from '../../../hooks/useDropdown'
import useSessionDefaults from '../../../hooks/useSessionDefaults'

const NO_BUNDLE_LABEL = 'No bundle'

/**
 * Bundle dropdown with leading separator; renders nothing when the workspace declares no bundle.
 * The pick is held until the next session is created from the welcome screen.
 */
export default function BundlePicker() {
  const sessionDefaults = useSessionDefaults()
  const { deferredBundle } = useSessionData()
  const { setDeferredBundle } = useSessionActions()
  const { isOpen, setIsOpen, containerRef, handleToggle, handleKeyDown } = useDropdown(false)

  const handleSelect = useCallback(
    name => {
      setIsOpen(false)
      setDeferredBundle(name)
    },
    [setDeferredBundle, setIsOpen],
  )

  const names = sessionDefaults?.bundle_names ?? []
  if (names.length === 0) {
    return null
  }

  return (
    <>
      <span className="footer-sep">|</span>
      <span
        className="footer-picker footer-bundle-picker"
        ref={containerRef}
        onKeyDown={handleKeyDown}>
        <button
          type="button"
          className="footer-picker-btn"
          onClick={handleToggle}
          title={`Bundle — ${deferredBundle || NO_BUNDLE_LABEL}`}
          data-testid="footer-bundle-picker">
          {deferredBundle || NO_BUNDLE_LABEL}
          <ChevronDown size={10} />
        </button>
        {isOpen && (
          <div className="footer-picker-dropdown" data-testid="bundle-dropdown">
            {[null, ...names].map(name => (
              <button
                key={name ?? ''}
                type="button"
                className={`dropdown-option footer-dropdown-option${name === deferredBundle ? ' selected' : ''}`}
                onClick={() => handleSelect(name)}>
                <span className="footer-dropdown-check">
                  {name === deferredBundle && <Check size={12} />}
                </span>
                <span className="footer-dropdown-name">{name ?? NO_BUNDLE_LABEL}</span>
              </button>
            ))}
          </div>
        )}
      </span>
    </>
  )
}
