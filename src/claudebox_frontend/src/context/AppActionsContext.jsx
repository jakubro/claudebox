/** Stable app actions and refs that never cause re-renders. */

import { createContext, useCallback, useContext, useMemo, useRef } from 'react'

const AppActionsContext = createContext(null)

/**
 * Provide stable actions and refs for app-wide coordination.
 *
 * All values are stable (refs or memoized callbacks) so consumers
 * never re-render due to this context changing.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 * @param {Function} props.onFocusChat - Focus the chat panel textarea.
 * @param {React.RefObject} props.panelSwitchingRef - Guard flag for scroll protection during panel activation.
 * @param {Function} props.onMaximizeToggle - Toggle panel group maximize.
 * @param {boolean} props.isMaximized - Whether a dockview group is currently maximized.
 * @param {Function} props.onClosePanel - Close a panel by ID.
 * @param {React.RefObject} props.jumpPrevRef - Ref for jump-to-previous-message callback.
 * @param {React.RefObject} props.jumpNextRef - Ref for jump-to-next-message callback.
 * @param {React.RefObject} props.jumpTopRef - Ref for jump-to-top callback.
 * @param {React.RefObject} props.jumpBottomRef - Ref for jump-to-bottom callback.
 * @param {React.RefObject} props.markUserIntentRef - Ref for markUserIntent callback (cross-panel scroll-intent signal).
 * @param {React.RefObject} props.markProgrammaticScrollRef - Ref for markProgrammaticScroll callback (brackets programmatic scroll writes from sibling panels).
 */
export function AppActionsProvider({
  children,
  onFocusChat,
  panelSwitchingRef,
  onMaximizeToggle,
  isMaximized,
  onClosePanel,
  jumpPrevRef,
  jumpNextRef,
  jumpTopRef,
  jumpBottomRef,
  markUserIntentRef,
  markProgrammaticScrollRef,
}) {
  // Chat scroll state (persists across tab switches)
  const chatScrollPositionRef = useRef(0)
  const chatAutoScrollEnabledRef = useRef(true)

  // Auto-collapse toggle (persists across ChatPanel remounts - tab/board
  // switches - like autoscroll; reset to true on session change / reload).
  const autoCollapseEnabledRef = useRef(true)

  const focusChatTab = useCallback(() => onFocusChat?.(), [onFocusChat])

  const value = useMemo(
    () => ({
      focusChatTab,
      maximizeToggle: onMaximizeToggle,
      isMaximized,
      closePanel: onClosePanel,
      chatScrollPositionRef,
      chatAutoScrollEnabledRef,
      autoCollapseEnabledRef,
      chatPanelSwitchingRef: panelSwitchingRef,
      jumpPrevRef,
      jumpNextRef,
      jumpTopRef,
      jumpBottomRef,
      markUserIntentRef,
      markProgrammaticScrollRef,
    }),
    [
      focusChatTab,
      onMaximizeToggle,
      isMaximized,
      onClosePanel,
      panelSwitchingRef,
      jumpPrevRef,
      jumpNextRef,
      jumpTopRef,
      jumpBottomRef,
      markUserIntentRef,
      markProgrammaticScrollRef,
    ],
  )

  return <AppActionsContext.Provider value={value}>{children}</AppActionsContext.Provider>
}

/** Access stable app actions and refs. */
export function useAppActions() {
  const context = useContext(AppActionsContext)
  if (!context) {
    throw new Error('useAppActions must be used within AppActionsProvider')
  }
  return context
}
