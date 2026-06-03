/** Single option row with indicator and content. */

import { getIndicator } from '../utils/getIndicator'

/**
 * Render a selectable option with radio/checkbox indicator and label.
 * @param {Object} props
 * @param {string} props.label - Option label text.
 * @param {string} [props.description] - Optional description below label.
 * @param {boolean} props.isSelected - Whether option is selected.
 * @param {boolean} props.multiSelect - Use checkbox vs radio indicator.
 * @param {boolean} [props.isOther] - Mark as "Other" option.
 * @param {boolean} [props.disabled=false] - Disable click interaction.
 * @param {Function} props.onClick - Click handler.
 * @param {React.ReactNode} [props.children] - Extra content after option.
 */
export default function QuestionOption({
  label,
  description,
  isSelected,
  multiSelect,
  isOther,
  disabled = false,
  onClick,
  children,
}) {
  const classes = [
    'tool-question-option',
    'interactive', // Always include for row layout
    isOther && 'other',
    isSelected && 'selected',
    disabled && 'disabled',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <div className={classes} onClick={disabled ? undefined : onClick}>
        <span className="tool-option-indicator">{getIndicator(multiSelect, isSelected)}</span>
        <div className="tool-option-content">
          <span className="tool-option-label">{label}</span>
          {description && <span className="tool-option-desc">{description}</span>}
        </div>
      </div>
      {children}
    </>
  )
}
