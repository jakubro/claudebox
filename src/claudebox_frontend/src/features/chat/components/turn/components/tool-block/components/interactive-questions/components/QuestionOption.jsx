/** Single option row with indicator and content. */

import { getIndicator } from '../utils/getIndicator'

/** @param {boolean} props.multiSelect - Use checkbox vs radio indicator. */
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
