/** Inline editor for renaming a session. */

import { Check, Pencil, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { updateSession } from '../../../../../api/sessions'

/**
 * Inline editor for renaming a session.
 * Renders either the rename (pencil) button or the full edit-mode UI
 * (input + save/cancel). When editing, the parent should hide the rest
 * of the left control group since the edit UI replaces it entirely.
 *
 * @param {Object} props
 * @param {string} props.sessionId - ID of the session to rename
 * @param {string|null} props.sessionName - Current session name
 * @param {Function} props.onSaved - Callback after successful save, receiving the new name (string or null)
 * @param {Function} props.children - Render function receiving { isEditing, renameButton }
 */
export default function SessionNameEditor({ sessionId, sessionName, onSaved, children }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const handleStartEdit = useCallback(() => {
    setEditValue(sessionName || '')
    setIsEditing(true)
  }, [sessionName])

  const handleSave = async () => {
    const trimmed = editValue.trim()
    const newName = trimmed || null
    if (newName !== sessionName) {
      try {
        await updateSession(sessionId, { name: newName })
        onSaved(newName)
      } catch (e) {
        console.warn('ChatControlBar: Failed to rename session', e)
      }
    }
    setIsEditing(false)
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  const handleEditKeyDown = e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSave()
    }
    if (e.key === 'Escape') {
      handleCancel()
    }
  }

  // Prevent blur from firing when clicking save/cancel buttons
  const preventBlur = e => e.preventDefault()

  const handleCancelMouseDown = e => {
    e.preventDefault()
    handleCancel()
  }

  if (isEditing) {
    return (
      <div className="panel-control-group chat-control-edit-mode">
        <input
          type="text"
          className="chat-control-edit-input"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={handleCancel}
          placeholder="Session name..."
          autoFocus
        />
        <button
          type="button"
          className="panel-control-btn chat-control-edit-save"
          onMouseDown={preventBlur}
          onClick={() => void handleSave()}
          title="Save">
          <Check size={12} />
        </button>
        <button
          type="button"
          className="panel-control-btn chat-control-edit-cancel"
          onMouseDown={handleCancelMouseDown}
          title="Cancel">
          <X size={12} />
        </button>
      </div>
    )
  }

  const renameButton = (
    <button
      type="button"
      className="panel-control-btn"
      onClick={handleStartEdit}
      disabled={!sessionId}
      title="Rename session">
      <Pencil size={12} />
    </button>
  )

  return children({ renameButton })
}
