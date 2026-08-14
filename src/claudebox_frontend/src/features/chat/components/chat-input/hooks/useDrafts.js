/** Manage textarea drafts with localStorage persistence. */

import { useEffect, useRef } from 'react'
import { DRAFT_STORAGE_PREFIX } from '../../../../../config/storage'
import useLocalStorage from '../../../../../hooks/useLocalStorage'

const DEFAULT_DRAFTS = { current: '', stack: [] } // audit-ignore: misplaced-constant

export default function useDrafts(sessionId, textareaRef, resizeTextarea) {
  // No debounce: saveDrafts is invoked from non-keystroke paths (submit, navigate-down push, in-place edit).
  // The per-keystroke write goes through ChatInput's persistDraftDirect instead, bypassing setValue.
  // Debouncing here would let post-submit {current: ''} flushes overwrite later direct writes.
  const [drafts, saveDrafts, flushDrafts] = useLocalStorage(
    sessionId ? `${DRAFT_STORAGE_PREFIX}${sessionId}` : null,
    DEFAULT_DRAFTS,
    {
      isEmpty: d => !d.current && (!d.stack || d.stack.length === 0),
    },
  )

  const prevSessionIdRef = useRef(null)
  const prevDraftCurrentRef = useRef(null)
  const userHasTypedRef = useRef(false)

  useEffect(() => {
    const prevSessionId = prevSessionIdRef.current
    const sessionChanged = sessionId !== prevSessionId
    const draftLoaded = drafts.current && drafts.current !== prevDraftCurrentRef.current

    // Reset typed flag on session switch so new session's draft can restore
    if (sessionChanged) {
      userHasTypedRef.current = false
    }

    prevSessionIdRef.current = sessionId
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
  }, [sessionId, drafts, textareaRef, resizeTextarea])

  useEffect(() => {
    window.addEventListener('beforeunload', flushDrafts)
    return () => window.removeEventListener('beforeunload', flushDrafts)
  }, [flushDrafts])

  return { drafts, saveDrafts, flushDrafts, userHasTypedRef }
}
