/** Confirm rewinding conversation to a previous turn with mode-specific text. */

import { Loader2 } from 'lucide-react'

const MODE_TEXT = {
  'fork-here': {
    title: 'Rewind here?',
    detail: 'Creates a new session from this point in the same container.',
  },
  'fork-browser-tab': {
    title: 'Rewind in new browser tab?',
    detail: 'Creates a new session from this point and opens it in a new browser tab.',
  },
}

const FORK_ALL_TEXT = {
  'fork-here': {
    title: 'Fork here?',
    detail: 'Creates a copy of the complete session in the same container.',
  },
  'fork-browser-tab': {
    title: 'Fork in new browser tab?',
    detail: 'Creates a copy of the complete session and opens it in a new browser tab.',
  },
}

const FALLBACK_TEXT = {
  title: 'Rewind to this message?',
  detail: 'Creates a new session from this point.',
}

/**
 * Render confirmation modal for conversation rewind with mode-aware text.
 * @param {Object} props
 * @param {string} [props.mode] - Fork mode: fork-here or fork-browser-tab.
 * @param {boolean} [props.forkAll] - Whether rewinding the entire session (no truncation).
 * @param {boolean} [props.forking] - Whether a rewind is in progress.
 * @param {Function} props.onConfirm - Callback when user confirms rewind.
 * @param {Function} props.onCancel - Callback when user cancels.
 */
export default function RewindModal({ mode, forkAll, forking = false, onConfirm, onCancel }) {
  const textMap = forkAll ? FORK_ALL_TEXT : MODE_TEXT
  const { title, detail } = textMap[mode] || FALLBACK_TEXT

  return (
    <div className="rewind-overlay" onClick={forking ? undefined : onCancel}>
      <div className="rewind-modal" onClick={e => e.stopPropagation()}>
        <p className="rewind-modal-title">{title}</p>
        <p className="rewind-modal-detail">{detail}</p>
        <div className="rewind-modal-actions">
          <button
            type="button"
            className="rewind-modal-cancel"
            onClick={onCancel}
            disabled={forking}>
            Cancel
          </button>
          <button
            type="button"
            className="rewind-modal-confirm"
            onClick={onConfirm}
            disabled={forking}>
            {forking ? <Loader2 size={14} className="spin" /> : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
