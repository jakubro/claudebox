/** Manage textarea drafts with localStorage persistence. */

import { useEffect, useRef } from 'react'
import useLocalStorage from '../../../../../hooks/useLocalStorage'

const DEFAULT_DRAFTS = { current: '', stack: [] } // audit-ignore: misplaced-constant

/** Provide draft state and save/flush operations for a session. */
export default function useDrafts(sessionId, textareaRef, resizeTextarea) {
  // No debounce: saveDrafts is invoked from non-keystroke paths (submit, navigate-down
  // push, in-place edit). The per-keystroke write goes through ChatInput's
  // persistDraftDirect (bypassing setValue). Debouncing here would let post-submit
  // {current: ''} flushes overwrite later direct writes (lost-typed-draft race).
  const [drafts, saveDrafts, flushDrafts] = useLocalStorage(
    sessionId ? `draft:${sessionId}` : null,
    DEFAULT_DRAFTS,
    {
      isEmpty: d => !d.current && (!d.stack || d.stack.length === 0),
    },
  )

  const prevSessionIdRef = useRef(null)
  const prevDraftCurrentRef = useRef(null)
  const userHasTypedRef = useRef(false)

  // Restore draft to textarea when:
  // 1. Session changes (switch sessions)
  // 2. Drafts load from localStorage (drafts.current changes from "" to stored value)
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

    // Clear stale text on real session switch (not initial mount). The new session's
    // draft loads asynchronously via useLocalStorage key-change effect, which
    // re-triggers this effect with draftLoaded=true.
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

  // Flush on browser close
  useEffect(() => {
    window.addEventListener('beforeunload', flushDrafts)
    return () => window.removeEventListener('beforeunload', flushDrafts)
  }, [flushDrafts])

  return { drafts, saveDrafts, flushDrafts, userHasTypedRef }
}
