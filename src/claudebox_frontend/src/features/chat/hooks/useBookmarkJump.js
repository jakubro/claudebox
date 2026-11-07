/** Jump to a part or tool-call bookmark: mount and open its turn, then land on the part itself. */

import { useCallback, useEffect } from 'react'
import { TaskKind } from '../../../config/schema'
import { MOUNT_TIMEOUT_MS } from '../../../config/timing'
import { parseTail } from '../../../utils/bookmarkIds'
import { isShellCallInTurn, resolveBookmarkTarget } from '../../../utils/bookmarkJump'
import { findTurnEl, pollFrames } from '../../../utils/mountTurn'
import { alignOffscreen } from '../../../utils/scroll'
import { jumpToTask } from '../../../utils/taskScroll'

const FLASH = { highlightClass: 'jump-highlight', highlightMs: 1500 }
const FALLBACK = Symbol('response')

/**
 * Publish `jumpToBookmarkRef` and return the jump. A tool call lands in whichever column shows it
 * now (`jumpToTaskRef`); a paragraph lands in the transcript, or on the response once gone.
 */
export default function useBookmarkJump({
  jumpToBookmarkRef,
  scrollToTurnRef,
  expandTurnRef,
  jumpToTaskRef,
  turnsRef,
  panelRef,
  messagesRef,
  markUserIntent,
  markProgrammaticScroll,
}) {
  const jump = useCallback(
    (turnId, tail) => {
      const target = parseTail(tail)
      // Following the bottom would unmount the turn again before the part is found.
      markUserIntent?.()
      if (target?.kind === 'tool') {
        jumpToTaskRef.current?.({
          id: target.toolUseId,
          turnId,
          kind: isShellCallInTurn(turnsRef.current, turnId, target.toolUseId)
            ? TaskKind.COMMAND
            : null,
          reveal: true,
          ...FLASH,
        })
        return
      }
      scrollToTurnRef.current?.(turnId, turnEl => {
        if (!turnEl) {
          return
        }
        // A turn drawn off screen, in the window's margin, can leave the window as it expands.
        alignOffscreen(messagesRef.current, turnEl, markProgrammaticScroll)
        expandTurnRef.current?.(turnId)
        const liveTurn = () => findTurnEl(turnId, panelRef.current)
        pollFrames(
          MOUNT_TIMEOUT_MS,
          () => {
            const turn = liveTurn()
            if (!turn) {
              return null
            }
            const part = resolveBookmarkTarget(turn, 'assistant', target)
            return part ?? (turn.querySelector('.turn-content-collapsed') ? null : FALLBACK)
          },
          found => {
            const el = found === FALLBACK ? null : found
            const landing =
              el ?? (liveTurn() && resolveBookmarkTarget(liveTurn(), 'assistant', null))
            if (landing) {
              jumpToTask(landing, messagesRef.current, {
                markUserIntent,
                markProgrammaticScroll,
                ...FLASH,
              })
            }
          },
        )
      })
    },
    [
      jumpToTaskRef,
      turnsRef,
      scrollToTurnRef,
      expandTurnRef,
      panelRef,
      messagesRef,
      markUserIntent,
      markProgrammaticScroll,
    ],
  )

  useEffect(() => {
    jumpToBookmarkRef.current = jump
    return () => {
      jumpToBookmarkRef.current = null
    }
  }, [jumpToBookmarkRef, jump])

  return jump
}
