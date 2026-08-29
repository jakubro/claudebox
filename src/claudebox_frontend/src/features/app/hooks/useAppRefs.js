/** Shared ref factory for jump, new-session, and scroll-intent callbacks. */

import { useRef } from 'react'

/**
 * Create the refs shared between DesktopLayout and MobileApp for AppProviders.
 * @returns {object} Structured refs for jumpRefs, rightColumnJumpRefs, newSessionRefs,
 *   scrollIntentRefs, and individual accessors.
 */
export default function useAppRefs() {
  const jumpPrevRef = useRef(null)
  const jumpNextRef = useRef(null)
  const jumpTopRef = useRef(null)
  const jumpBottomRef = useRef(null)
  // Alt+PageUp/PageDown - the right split slot's binding, whichever view occupies it. Populated
  // by ChatPanel while that column is visible, null otherwise.
  const rightColumnPrevRef = useRef(null)
  const rightColumnNextRef = useRef(null)
  // Alt+Shift+Left/Right - moves focus one group along the session rail; populated by SessionRail,
  // null when the rail has only one group (nothing to move focus to).
  const railPrevRef = useRef(null)
  const railNextRef = useRef(null)
  const newSessionRef = useRef(null)
  const newSessionInNewTabRef = useRef(null)
  // Scroll-intent callbacks reach ChatController from sibling panels (BookmarksPanel currently).
  // Populated by ChatPanel after useChatController runs.
  const markUserIntentRef = useRef(null)
  const markProgrammaticScrollRef = useRef(null)
  // The focused rail group's own root DOM node, populated by ChatPanel on mount. Readers outside
  // the rail scope their document queries to it, so an ancestor's elements never match.
  const focusedGroupRootRef = useRef(null)

  return {
    jumpRefs: { prev: jumpPrevRef, next: jumpNextRef, top: jumpTopRef, bottom: jumpBottomRef },
    rightColumnJumpRefs: { prev: rightColumnPrevRef, next: rightColumnNextRef },
    railJumpRefs: { prev: railPrevRef, next: railNextRef },
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
    focusedGroupRootRef,
  }
}
