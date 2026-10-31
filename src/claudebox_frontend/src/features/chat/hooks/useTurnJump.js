/** Scroll-and-highlight a turn (possibly windowed out) - for replay-jump and terminal clicks. */

import { useCallback, useEffect, useRef } from 'react'
import { withMountedTurn } from '../../../utils/mountTurn'
import { scrollAndHighlight } from '../../../utils/scroll'

/**
 * Also runs the replay jump: once `isReplaying` clears, a URL-carried `activeTurnId` is scrolled to
 * and highlighted with autoscroll disengaged; a URL-carried part goes to `jumpToBookmark` instead.
 */
export function useTurnJump({
  turnsRef,
  turnVirtualizerRef,
  messagesRef,
  chatAutoScrollEnabledRef,
  isReplaying,
  activeTurnId,
  activeMessageType,
  activeTarget = null,
  jumpToBookmark = null,
}) {
  const scrollToTurnAndHighlight = useCallback(
    (turnId, { preferUser = false } = {}) => {
      withMountedTurn({
        turnId,
        turns: turnsRef.current.slice(0, -1),
        virtualizer: turnVirtualizerRef.current,
        onResolved: turnEl => {
          const scrollContainer = messagesRef.current
          if (!(turnEl && scrollContainer)) {
            return
          }
          let target = preferUser ? turnEl.querySelector('[data-testid="message-user"]') : null
          if (!target) {
            target = turnEl.querySelector('[data-testid="message-assistant"]') || turnEl
          }
          chatAutoScrollEnabledRef.current = false
          scrollAndHighlight(scrollContainer, target)
        },
      })
    },
    [turnsRef, turnVirtualizerRef, messagesRef, chatAutoScrollEnabledRef],
  )

  // Orphan entries (no turnId) get no jump - second guard; TerminalEntry gates onClick too.
  const handleTerminalEntryClick = useCallback(
    entry => {
      if (entry.turnId == null) {
        return
      }
      scrollToTurnAndHighlight(entry.turnId)
    },
    [scrollToTurnAndHighlight],
  )

  // Cross-session jump after replay: the URL `/turns/<role>-<id>` segment carries the target.
  const wasReplayingRef = useRef(false)
  useEffect(() => {
    if (isReplaying) {
      wasReplayingRef.current = true
      return
    }
    if (!wasReplayingRef.current) {
      return
    }
    wasReplayingRef.current = false

    if (!activeTurnId) {
      return
    }

    if (activeTarget && jumpToBookmark) {
      jumpToBookmark(activeTurnId, activeTarget)
      return
    }
    scrollToTurnAndHighlight(activeTurnId, { preferUser: activeMessageType === 'user' })
  }, [
    isReplaying,
    activeTurnId,
    activeMessageType,
    activeTarget,
    jumpToBookmark,
    scrollToTurnAndHighlight,
  ])

  return { scrollToTurnAndHighlight, handleTerminalEntryClick }
}
