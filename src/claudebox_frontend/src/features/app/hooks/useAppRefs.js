/** Shared ref factory for jump, new-session, and scroll-intent callbacks. */

import { useRef } from 'react'

/**
 * Create the refs shared between DesktopLayout and MobileApp for AppProviders.
 * @returns {object} Structured refs for jumpRefs, newSessionRefs, scrollIntentRefs, and individual accessors.
 */
export default function useAppRefs() {
  const jumpPrevRef = useRef(null)
  const jumpNextRef = useRef(null)
  const jumpTopRef = useRef(null)
  const jumpBottomRef = useRef(null)
  const newSessionRef = useRef(null)
  const newSessionInNewTabRef = useRef(null)
  // Scroll-intent callbacks reach ChatController from sibling panels
  // (BookmarksPanel today, TasksPanel and ChatPanel post-replay in follow-ups).
  // Populated by ChatPanel after useChatController runs.
  const markUserIntentRef = useRef(null)
  const markProgrammaticScrollRef = useRef(null)

  return {
    jumpRefs: { prev: jumpPrevRef, next: jumpNextRef, top: jumpTopRef, bottom: jumpBottomRef },
    newSessionRefs: {
      newSession: newSessionRef,
      newSessionInNewTab: newSessionInNewTabRef,
    },
    scrollIntentRefs: {
      userIntent: markUserIntentRef,
      programmaticScroll: markProgrammaticScrollRef,
    },
    newSessionRef,
    newSessionInNewTabRef,
  }
}
