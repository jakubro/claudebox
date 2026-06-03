/** Interactive question form for AskUserQuestion tool. */

import { Send } from 'lucide-react'
import { useState } from 'react'
import QuestionCard from '../QuestionCard'
import QuestionOption from './components/QuestionOption'
import { hasAnySelection, nextOtherSelected, nextSelections } from './utils/selectionState'
import { formatQuestionXml } from './utils/serializers'

/**
 * Render question cards with single/multi-select options and "Other" text input.
 * @param {Object} props
 * @param {Array} props.questions - Questions with options to display.
 * @param {Function} props.onSubmit - Callback with XML response string.
 * @param {boolean} [props.disabled=false] - Disable interactions after submission.
 * @param {string} [props.responseTag='AskUserQuestion'] - XML wrapper tag name.
 */
export default function InteractiveQuestions({
  questions,
  onSubmit,
  disabled = false,
  responseTag = 'AskUserQuestion',
}) {
  // Track selections: { questionIndex: selectedOptionIndex | Set<number> for multiSelect }
  const [selections, setSelections] = useState(() => {
    const initial = {}
    questions?.forEach((q, i) => {
      initial[i] = q.multiSelect ? new Set() : null
    })
    return initial
  })
  // Track "Other" text per question
  const [otherTexts, setOtherTexts] = useState({})
  // Track which questions have "Other" selected
  const [otherSelected, setOtherSelected] = useState({})

  const handleOptionClick = (qIndex, optIndex, multiSelect) => {
    if (disabled) {
      return
    }
    setSelections(prev => nextSelections(prev, qIndex, optIndex, multiSelect))
    if (!multiSelect) {
      // Clear "Other" selection when selecting an option
      setOtherSelected(prev => ({ ...prev, [qIndex]: false }))
    }
  }

  const handleOtherToggle = (qIndex, multiSelect) => {
    if (disabled) {
      return
    }
    setOtherSelected(prev => nextOtherSelected(prev, qIndex, multiSelect))
    if (!multiSelect) {
      setSelections(prev => ({ ...prev, [qIndex]: null }))
    }
  }

  const handleOtherText = (qIndex, text) => {
    if (disabled) {
      return
    }
    setOtherTexts(prev => ({ ...prev, [qIndex]: text }))
  }

  const handleSubmit = () => {
    if (disabled) {
      return
    }
    const xmlParts = []
    questions?.forEach((q, i) => {
      const questionXml = formatQuestionXml(q, i, selections, otherSelected, otherTexts)
      if (questionXml) {
        xmlParts.push(questionXml)
      }
    })
    if (xmlParts.length > 0) {
      const xmlContent = xmlParts.join('\n')
      onSubmit(`<response:${responseTag}>\n${xmlContent}\n</response:${responseTag}>`)
    }
  }

  // Handle Shift+Enter in "Other" textarea
  const handleOtherKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter without shift - prevent default (submit handled elsewhere)
      e.preventDefault()
    }
    // Shift+Enter will naturally insert newline in textarea
  }

  // Check if any selection made (preserve whitespace - check length, not trim)
  const hasSelection = hasAnySelection(questions, selections, otherSelected, otherTexts)

  // Show form in disabled state after submit (selections stay visible/highlighted)
  return (
    <div className={`tool-questions-interactive ${disabled ? 'disabled' : ''}`}>
      {questions?.map((q, qIdx) => (
        <QuestionCard key={qIdx} header={q.header} question={q.question}>
          {q.options?.map((opt, optIdx) => {
            const isSelected = q.multiSelect
              ? selections[qIdx]?.has(optIdx)
              : selections[qIdx] === optIdx
            return (
              <QuestionOption
                key={optIdx}
                label={opt.label}
                description={opt.description}
                isSelected={isSelected}
                multiSelect={q.multiSelect}
                disabled={disabled}
                onClick={() => handleOptionClick(qIdx, optIdx, q.multiSelect)}
              />
            )
          })}
          <QuestionOption
            label="Other"
            isSelected={otherSelected[qIdx]}
            multiSelect={q.multiSelect}
            isOther
            disabled={disabled}
            onClick={() => handleOtherToggle(qIdx, q.multiSelect)}>
            {otherSelected[qIdx] && (
              <textarea
                ref={el => {
                  if (el) {
                    el.style.height = `${el.scrollHeight}px`
                  }
                }}
                className="tool-other-input"
                value={otherTexts[qIdx] || ''}
                onChange={e => {
                  handleOtherText(qIdx, e.target.value)
                  // Auto-resize
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                onKeyDown={e => handleOtherKeyDown(e, qIdx)}
                onClick={e => e.stopPropagation()}
                rows={1}
                autoFocus={!disabled}
                disabled={disabled}
              />
            )}
          </QuestionOption>
        </QuestionCard>
      ))}
      {!disabled && (
        <button
          type="button"
          className="tool-submit-btn"
          onClick={handleSubmit}
          disabled={!hasSelection}>
          <Send size={14} />
          <span>Submit Response</span>
        </button>
      )}
    </div>
  )
}
