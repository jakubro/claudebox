/** Modal for registering a new workspace by absolute path. */

import { useCallback, useState } from 'react'
import { registerWorkspace } from '../../../api/workspaces'

/**
 * Register-workspace modal — daemon errors inline, auto-close on already_registered.
 *
 * @param {object} props
 * @param {Function} props.onClose - Dismiss the modal (Cancel / Esc).
 * @param {Function} props.onSuccess - Called with the registered workspace record
 *   `{id, path, already_registered?}` so the caller can refresh the list.
 */
function RegisterWorkspaceModal({ onClose, onSuccess }) {
  const [path, setPath] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    const trimmed = path.trim()
    if (!trimmed) {
      return
    }
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const ws = await registerWorkspace(trimmed)
      onSuccess?.(ws)
      if (ws?.already_registered) {
        setNotice(`Already registered as ${ws.id}`)
        setTimeout(() => onClose(), 1000)
      } else {
        onClose()
      }
    } catch (err) {
      setError(err.message || 'Failed to register workspace')
    } finally {
      setSubmitting(false)
    }
  }, [path, onClose, onSuccess])

  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [handleSubmit, onClose],
  )

  const canSubmit = path.trim().length > 0 && !submitting

  return (
    <div className="register-workspace-overlay" onClick={onClose}>
      <div
        className="register-workspace-modal"
        onClick={e => e.stopPropagation()}
        data-testid="register-workspace-modal">
        <p className="register-workspace-title">Register workspace</p>
        <label className="register-workspace-label" htmlFor="register-workspace-path">
          Path
        </label>
        <input
          id="register-workspace-path"
          type="text"
          className="register-workspace-input"
          value={path}
          onChange={e => setPath(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="/absolute/path/to/workspace"
          autoFocus
          data-testid="register-workspace-input"
        />
        {error && (
          <p className="register-workspace-error" data-testid="register-workspace-error">
            {error}
          </p>
        )}
        {notice && (
          <p className="register-workspace-notice" data-testid="register-workspace-notice">
            ✓ {notice}
          </p>
        )}
        <div className="register-workspace-actions">
          <button
            type="button"
            className="register-workspace-cancel"
            onClick={onClose}
            data-testid="register-workspace-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="register-workspace-confirm"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            data-testid="register-workspace-confirm">
            Register
          </button>
        </div>
      </div>
    </div>
  )
}

export default RegisterWorkspaceModal
