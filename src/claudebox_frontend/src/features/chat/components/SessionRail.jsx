/** Horizontal rail of session groups - ancestors read-only to the left, one focused group live. */

import { useEffect, useRef } from 'react'
import { useAppActions } from '../../../context/AppActionsContext'
import ChatPanel from '../ChatPanel'
import useSessionRail from '../hooks/useSessionRail'
import AncestorGroup from './AncestorGroup'

/**
 * Drilling pushes a group to the right; one group is a live `ChatPanel`, the rest `AncestorGroup`s.
 * The focused slot is fixed and unkeyed, so nothing remounts it; per-session state keys on its owner.
 */
export default function SessionRail() {
  const { renderedGroups, focusedSessionId, focusPrev, focusNext } = useSessionRail()
  const { railPrevRef, railNextRef } = useAppActions()
  const focusedGroupRef = useRef(null)

  // Alt+Shift+Left/Right, dispatched from useKeyboardShortcuts - null when the rail has one group.
  useEffect(() => {
    railPrevRef.current = focusPrev
    railNextRef.current = focusNext
    return () => {
      railPrevRef.current = null
      railNextRef.current = null
    }
  }, [railPrevRef, railNextRef, focusPrev, focusNext])

  // Bring the focused group fully into view whenever focus moves - drilling deep enough scrolls
  // the rail sideways rather than leaving the newly-focused group partly offscreen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusedSessionId is the re-run trigger
  useEffect(() => {
    focusedGroupRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [focusedSessionId])

  const focusedIndex = renderedGroups.findIndex(group => group.isFocused)
  const before = focusedIndex >= 0 ? renderedGroups.slice(0, focusedIndex) : []
  const after = focusedIndex >= 0 ? renderedGroups.slice(focusedIndex + 1) : []

  return (
    <div className="chat-rail" data-testid="chat-rail">
      {before.map(group => (
        <AncestorGroup key={group.sessionId} sessionId={group.sessionId} />
      ))}
      <div className="chat-rail-focused" ref={focusedGroupRef}>
        <ChatPanel />
      </div>
      {after.map(group => (
        <AncestorGroup key={group.sessionId} sessionId={group.sessionId} />
      ))}
    </div>
  )
}
