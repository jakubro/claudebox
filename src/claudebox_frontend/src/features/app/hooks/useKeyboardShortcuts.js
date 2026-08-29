/** Global keyboard shortcut handler for panel toggles and navigation. */

import { useEffect } from 'react'
import { HELP_OVERLAY_KEY } from '../../../config/layout'

/**
 * @param {object} params
 * @param {Function} params.handleTogglePanel - Toggle a side panel by ID.
 * @param {Function} params.focusChatTab - Focus the chat panel.
 * @param {boolean} params.showHelpOverlay - Whether help overlay is visible.
 * @param {Function} params.setShowHelpOverlay - Toggle help overlay state.
 * @param {object} params.jumpPrevRef - Ref to jump-to-previous-message callback.
 * @param {object} params.jumpNextRef - Ref to jump-to-next-message callback.
 * @param {object} params.jumpTopRef - Ref to jump-to-top callback.
 * @param {object} params.jumpBottomRef - Ref to jump-to-bottom callback.
 * @param {object} params.rightColumnPrevRef - Right split slot's step-prev; null makes it a no-op.
 * @param {object} params.rightColumnNextRef - Right split slot's step-next callback ref.
 * @param {object} params.railPrevRef - Rail focus-prev (Alt+Shift+Left); null makes it a no-op.
 * @param {object} params.railNextRef - Rail focus-next callback (Alt+Shift+Right).
 * @param {Function} params.onNewSession - Create new session in current tab.
 * @param {Function} params.onNewSessionInNewTab - Create new session in new browser tab.
 */
export default function useKeyboardShortcuts({
  handleTogglePanel,
  focusChatTab,
  showHelpOverlay,
  setShowHelpOverlay,
  jumpPrevRef,
  jumpNextRef,
  jumpTopRef,
  jumpBottomRef,
  rightColumnPrevRef,
  rightColumnNextRef,
  railPrevRef,
  railNextRef,
  onNewSession,
  onNewSessionInNewTab,
}) {
  useEffect(() => {
    const handleKeyDown = e => {
      // Alt+Arrow: jump between human messages
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        jumpPrevRef.current?.()
        return
      }
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        jumpNextRef.current?.()
        return
      }

      // Alt+Home/End: jump to top/bottom of chat
      if (e.altKey && e.key === 'Home') {
        e.preventDefault()
        jumpTopRef.current?.()
        return
      }
      if (e.altKey && e.key === 'End') {
        e.preventDefault()
        jumpBottomRef.current?.()
        return
      }

      // Alt+PageUp/PageDown: step whatever occupies the right split slot, never the transcript.
      if (e.altKey && e.key === 'PageUp') {
        e.preventDefault()
        rightColumnPrevRef.current?.()
        return
      }
      if (e.altKey && e.key === 'PageDown') {
        e.preventDefault()
        rightColumnNextRef.current?.()
        return
      }

      // Alt+Shift+Left/Right: move focus one group along the session rail; clamps at both ends.
      if (e.altKey && e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        railPrevRef.current?.()
        return
      }
      if (e.altKey && e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault()
        railNextRef.current?.()
        return
      }

      // Escape: close help overlay and refocus textarea
      if (e.key === 'Escape') {
        if (showHelpOverlay) {
          setShowHelpOverlay(false)
          document.querySelector('.chat-input textarea')?.focus()
        }
        return
      }

      // Alt+N: panel toggles
      if (!e.altKey) {
        return
      }

      const toggleHelpOverlay = () => {
        setShowHelpOverlay(prev => {
          if (!prev) {
            document.activeElement?.blur()
          } else {
            document.querySelector('.chat-input textarea')?.focus()
          }
          return !prev
        })
      }

      const keyMap = {
        [HELP_OVERLAY_KEY]: toggleHelpOverlay,
        '/': toggleHelpOverlay,
        c: focusChatTab,
        C: focusChatTab,
        n: () => onNewSession?.(),
        N: () => onNewSessionInNewTab?.(),
        0: () => handleTogglePanel('logs'),
        1: () => handleTogglePanel('sessions'),
        2: () => handleTogglePanel('todos'),
        3: () => handleTogglePanel('stash'),
        4: () => handleTogglePanel('tasks'),
        5: () => handleTogglePanel('bookmarks'),
        6: () => handleTogglePanel('boards'),
        7: () => handleTogglePanel('usage'),
        8: () => handleTogglePanel('mcp'),
        9: () => handleTogglePanel('commands'),
      }

      const handler = keyMap[e.key]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    // Published only while a listener is attached, so a test can wait for the shortcut to be live
    // rather than for an earlier paint. Reset every render (not latched) - the effect re-subscribes
    // each render and the swap is synchronous, so the flag never blinks off.
    document.body.dataset.shortcutsReady = 'true'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      delete document.body.dataset.shortcutsReady
    }
  }, [
    handleTogglePanel,
    focusChatTab,
    showHelpOverlay,
    setShowHelpOverlay,
    jumpPrevRef,
    jumpNextRef,
    jumpTopRef,
    jumpBottomRef,
    rightColumnPrevRef,
    rightColumnNextRef,
    railPrevRef,
    railNextRef,
    onNewSession,
    onNewSessionInNewTab,
  ])
}
