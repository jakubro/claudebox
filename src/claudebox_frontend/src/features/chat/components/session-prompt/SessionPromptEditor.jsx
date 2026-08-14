/** Session prompt editor dropdown for per-session text that survives compaction. */

import { StickyNote } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { updateSessionPrompt } from '../../../../api/sessions'
import { useSessionActions, useSessionData } from '../../../../context/SessionDataContext'
import useDropdown from '../../../../hooks/useDropdown'

/**
 * Saved on close (click-outside or Escape); a blue badge shows when content is set.
 * Persists in session.json and is sent to Claude after each compaction.
 *
 * @param {object} props
 * @param {boolean} props.disabled - True when button should be inactive.
 */
export default function SessionPromptEditor({ disabled }) {
  const { sessionId, sessionPrompt } = useSessionData()
  const { refreshSession } = useSessionActions()
  const { isOpen, containerRef, handleToggle, handleKeyDown } = useDropdown(disabled)
  const textareaRef = useRef(null)
  const draftRef = useRef(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.value = sessionPrompt || ''
      draftRef.current = sessionPrompt || ''
      textareaRef.current.focus()
    }
  }, [isOpen, sessionPrompt])

  // Save on close (open -> closed); textarea is already unmounted, so read from draftRef.
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      const value = draftRef.current?.trim() || null
      const current = sessionPrompt || null
      if (value !== current && sessionId) {
        updateSessionPrompt(value)
          .then(() => refreshSession())
          .catch(err => console.warn('SessionPromptEditor: updateSessionPrompt failed', err))
      }
    }
    wasOpenRef.current = isOpen
  }, [isOpen, sessionId, sessionPrompt, refreshSession])

  const hasContent = !!sessionPrompt
  const btnClass = `panel-control-btn session-prompt-btn${hasContent ? ' has-content' : ''}`

  return (
    <span className="session-prompt-container" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={btnClass}
        disabled={disabled}
        onClick={handleToggle}
        title={hasContent ? 'Edit session prompt' : 'Set session prompt'}>
        <StickyNote size={12} />
      </button>
      {isOpen && (
        <div className="session-prompt-dropdown">
          <div className="session-prompt-label">Session prompt</div>
          <textarea
            ref={textareaRef}
            className="session-prompt-textarea"
            placeholder="Text injected after each compaction..."
            defaultValue={sessionPrompt || ''}
            onInput={e => {
              draftRef.current = e.target.value
            }}
          />
        </div>
      )}
    </span>
  )
}
