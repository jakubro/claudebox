/** Stable app actions and refs that never cause re-renders. */

import { createContext, useCallback, useContext, useMemo, useRef } from 'react'

const AppActionsContext = createContext(null)

/**
 * Stable actions and refs (refs or memoized callbacks) for app-wide coordination - consumers
 * never re-render when this context changes.
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
 * @param {React.RefObject} props.rightColumnPrevRef - Right split slot's step-prev (Alt+PageUp).
 * @param {React.RefObject} props.rightColumnNextRef - Right split slot's step-next (Alt+PageDown).
 * @param {React.RefObject} props.markUserIntentRef - Cross-panel scroll-intent signal ref.
 * @param {React.RefObject} props.markProgrammaticScrollRef - Brackets programmatic scroll writes from sibling panels.
 * @param {React.RefObject} props.focusedGroupRootRef - Focused rail group's own root DOM node.
 * @param {React.RefObject} props.railPrevRef - Rail focus-prev callback (Alt+Shift+Left).
 * @param {React.RefObject} props.railNextRef - Rail focus-next callback (Alt+Shift+Right).
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
  rightColumnPrevRef,
  rightColumnNextRef,
  markUserIntentRef,
  markProgrammaticScrollRef,
  focusedGroupRootRef,
  railPrevRef,
  railNextRef,
}) {
  // Chat scroll state (persists across tab switches)
  const chatScrollPositionRef = useRef(0)
  const chatAutoScrollEnabledRef = useRef(true)

  // Auto-collapse toggle persists across ChatPanel remounts (tab/board switches) like
  // autoscroll; resets to true on session change/reload.
  const autoCollapseEnabledRef = useRef(true)

  // Registered by ChatPanel; sibling panels (Bookmarks today) jump to a turn through this
  // instead of querying the DOM, since a windowed turn outside the viewport has no element.
  const scrollToTurnRef = useRef(null)

  // Registered by ChatPanel; lets sibling panels open a collapsed turn before jumping into it.
  const expandTurnRef = useRef(null)

  // Registered by ChatPanel; the Tasks panel jumps to a task's tool block through this and lets
  // the chat area pick the destination column, rather than resolving the active view itself.
  const jumpToTaskRef = useRef(null)

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
      scrollToTurnRef,
      expandTurnRef,
      jumpToTaskRef,
      jumpPrevRef,
      jumpNextRef,
      jumpTopRef,
      jumpBottomRef,
      rightColumnPrevRef,
      rightColumnNextRef,
      markUserIntentRef,
      markProgrammaticScrollRef,
      focusedGroupRootRef,
      railPrevRef,
      railNextRef,
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
      rightColumnPrevRef,
      rightColumnNextRef,
      markUserIntentRef,
      markProgrammaticScrollRef,
      focusedGroupRootRef,
      railPrevRef,
      railNextRef,
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
