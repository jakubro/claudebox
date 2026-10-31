/** Manage textarea drafts with localStorage persistence, keyed by the session they belong to. */

import { useEffect, useRef } from 'react'
import { DRAFT_STORAGE_PREFIX } from '../../../../../config/storage'
import useLocalStorage from '../../../../../hooks/useLocalStorage'

const DEFAULT_DRAFTS = { current: '', stack: [] } // audit-ignore: misplaced-constant

/**
 * @param {string|null} ownerSessionId - The session on screen; during an open it is the one opening,
 *   so text typed meanwhile is saved as that session's draft.
 */
export default function useDrafts(ownerSessionId, textareaRef, resizeTextarea) {
  // No debounce: saveDrafts is invoked from non-keystroke paths (submit, navigate-down push, in-place edit).
  // The per-keystroke write goes through ChatInput's persistDraftDirect instead, bypassing setValue.
  // Debouncing here would let post-submit {current: ''} flushes overwrite later direct writes.
  const [drafts, saveDrafts, flushDrafts] = useLocalStorage(
    ownerSessionId ? `${DRAFT_STORAGE_PREFIX}${ownerSessionId}` : null,
    DEFAULT_DRAFTS,
    {
      isEmpty: d => !d.current && (!d.stack || d.stack.length === 0),
    },
  )

  // audit-ignore: session-transition-guard - the owner changes at the click, before typing for it
  const prevSessionIdRef = useRef(null)
  const prevDraftCurrentRef = useRef(null)
  const userHasTypedRef = useRef(false)

  useEffect(() => {
    const prevSessionId = prevSessionIdRef.current
    const sessionChanged = ownerSessionId !== prevSessionId
    const draftLoaded = drafts.current && drafts.current !== prevDraftCurrentRef.current

    // Reset typed flag on session switch so new session's draft can restore
    if (sessionChanged) {
      userHasTypedRef.current = false
    }

    prevSessionIdRef.current = ownerSessionId
    prevDraftCurrentRef.current = drafts.current

    // Clear stale text on a real session switch (not initial mount).
    // The draft loads asynchronously via useLocalStorage's key-change effect, re-triggering with draftLoaded=true.
    if (sessionChanged && prevSessionId !== null && textareaRef.current) {
      textareaRef.current.value = ''
      resizeTextarea()
      return
    }

    // Restore when draft loads from localStorage (initial mount or async load)
    if (draftLoaded && drafts.current && textareaRef.current) {
      // Don't overwrite if user has typed since last session switch / submit
      if (!(userHasTypedRef.current || textareaRef.current.value)) {
        textareaRef.current.value = drafts.current
        resizeTextarea()
      }
    }
  }, [ownerSessionId, drafts, textareaRef, resizeTextarea])

  useEffect(() => {
    window.addEventListener('beforeunload', flushDrafts)
    return () => window.removeEventListener('beforeunload', flushDrafts)
  }, [flushDrafts])

  return { drafts, saveDrafts, flushDrafts, userHasTypedRef }
}
