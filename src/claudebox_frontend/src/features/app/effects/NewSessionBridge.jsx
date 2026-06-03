/** Populate new-session refs from within the provider tree. */

import useNewSession from '../../../hooks/useNewSession'

/**
 * Populate new-session refs from within the provider tree where useNewSession works.
 * @param {object} props
 * @param {object} props.refs - Refs to populate with session creation callbacks.
 */
export default function NewSessionBridge({ refs }) {
  const { executeNewSession, executeNewSessionInNewTab } = useNewSession()

  if (refs?.newSession) {
    refs.newSession.current = executeNewSession
  }
  if (refs?.newSessionInNewTab) {
    refs.newSessionInNewTab.current = executeNewSessionInNewTab
  }
  // cancelCreation is wired inside executeNewSession itself — the closure captures
  // the calling instance's refs, so cancel always operates on the correct state
  // even when Dockview remounts the calling component (e.g., HeaderActions).

  return null
}
