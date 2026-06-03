/** Confirmation modal for deregistering a workspace. */

/**
 * Confirmation modal for deregistering a workspace.
 *
 * @param {object} props
 * @param {object} props.workspace - Workspace record `{id, path}`.
 * @param {Function} props.onConfirm - Proceed with deregistration.
 * @param {Function} props.onCancel - Back out.
 */
function ConfirmDeregisterModal({ workspace, onConfirm, onCancel }) {
  return (
    <div className="confirm-deregister-overlay" onClick={onCancel}>
      <div
        className="confirm-deregister-modal"
        onClick={e => e.stopPropagation()}
        data-testid="confirm-deregister-modal">
        <p className="confirm-deregister-title">Deregister workspace?</p>
        <p className="confirm-deregister-detail">
          {workspace.id} ({workspace.path}) — the <code>.workspace</code> marker file on disk is
          preserved.
        </p>
        <div className="confirm-deregister-actions">
          <button
            type="button"
            className="confirm-deregister-cancel"
            onClick={onCancel}
            data-testid="confirm-deregister-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="confirm-deregister-confirm"
            onClick={onConfirm}
            data-testid="confirm-deregister-confirm">
            Deregister
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDeregisterModal
