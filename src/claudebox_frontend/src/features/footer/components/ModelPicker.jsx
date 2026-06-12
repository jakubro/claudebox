/** Model picker dropdown for switching Claude model at runtime. */

import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSessionActions, useSessionData } from '../../../context/SessionDataContext'
import useCapabilities from '../../../hooks/useCapabilities'
import useDropdown from '../../../hooks/useDropdown'

/**
 * Render a footer dropdown for selecting the active Claude model.
 *
 * Available models come from SessionDataContext (fetched once on connect).
 * Optimistically updates on selection; confirmed by next session refresh.
 * On welcome (no active session), `defaultValue` populates the display so
 * the picker shows what a new session would inherit.
 *
 * @param {object} props
 * @param {string|null} props.currentModel - Currently active model name.
 * @param {string|null} [props.defaultValue] - Default model used when no active session value.
 * @param {boolean} props.disabled - True when picker should not open (e.g., during response).
 */
export default function ModelPicker({ currentModel, defaultValue, disabled }) {
  const { capabilities } = useCapabilities()
  const { availableModels } = useSessionData()
  const { setModel } = useSessionActions()
  const { isOpen, setIsOpen, containerRef, handleToggle, handleKeyDown } = useDropdown(disabled)
  const [optimisticModel, setOptimisticModel] = useState(null)

  // Clear optimistic override when session data confirms the change
  useEffect(() => {
    if (currentModel && optimisticModel && currentModel === optimisticModel) {
      setOptimisticModel(null)
    }
  }, [currentModel, optimisticModel])

  const effectiveModel = optimisticModel || currentModel || defaultValue

  const handleSelect = useCallback(
    modelId => {
      setIsOpen(false)
      if (modelId !== effectiveModel) {
        setOptimisticModel(modelId)
        setModel(modelId)
      }
    },
    [effectiveModel, setModel, setIsOpen],
  )

  if (
    capabilities &&
    !(capabilities.supports_models && capabilities.supports_set_model_mid_session)
  ) {
    return null
  }

  const displayName =
    availableModels.find(m => m.id === effectiveModel)?.name || effectiveModel || '-'

  return (
    <span
      className="footer-picker footer-model-picker"
      ref={containerRef}
      onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="footer-picker-btn"
        disabled={disabled}
        onClick={handleToggle}
        title={`Model - ${effectiveModel || '-'}`}
        data-testid="footer-model">
        {displayName}
        <ChevronDown size={10} />
      </button>
      {isOpen && (
        <div className="footer-picker-dropdown footer-model-dropdown" data-testid="model-dropdown">
          {availableModels.map(m => (
            <button
              key={m.id}
              type="button"
              className={`dropdown-option footer-dropdown-option footer-model-option${m.id === effectiveModel ? ' selected' : ''}`}
              onClick={() => handleSelect(m.id)}>
              <span className="footer-dropdown-check footer-model-option-check">
                {m.id === effectiveModel && <Check size={12} />}
              </span>
              <span className="footer-dropdown-name footer-model-option-name">{m.name}</span>
              <span className="footer-model-option-id">{m.id}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
