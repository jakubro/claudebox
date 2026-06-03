/** Confirmation modal for stop / reload actions while Claude is responding. */

const VARIANT_DETAIL = {
  stop: 'Stopping the session will end the response. Continue?',
  reload: 'Reloading will end the response. Continue?',
}

/**
 * Render confirmation modal for an action that interrupts the active response.
 *
 * Title is fixed ("Claude is working"); the detail line varies by `variant`.
 *
 * @param {object} props
 * @param {'stop'|'reload'} [props.variant='stop'] - Which action is about to interrupt the response.
 * @param {Function} props.onConfirm - Proceed with the destructive action.
 * @param {Function} props.onCancel - Back out and leave the response running.
 */
export default function ConfirmStopModal({ variant = 'stop', onConfirm, onCancel }) {
  const detail = VARIANT_DETAIL[variant] ?? VARIANT_DETAIL.stop

  return (
    <div className="confirm-stop-overlay" onClick={onCancel}>
      <div
        className="confirm-stop-modal"
        onClick={e => e.stopPropagation()}
        data-testid="confirm-stop-modal">
        <p className="confirm-stop-modal-title" data-testid="confirm-stop-modal-title">
          Claude is working
        </p>
        <p className="confirm-stop-modal-detail" data-testid="confirm-stop-modal-detail">
          {detail}
        </p>
        <div className="confirm-stop-modal-actions">
          <button
            type="button"
            className="confirm-stop-modal-cancel"
            data-testid="confirm-stop-modal-cancel"
            onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="confirm-stop-modal-confirm"
            data-testid="confirm-stop-modal-confirm"
            onClick={onConfirm}>
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
