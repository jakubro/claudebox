/** The "This session" / "All sessions" tab, following whether a session is open. */

import { useEffect, useState } from 'react'

/** Return `[tab, setTab]`; a tab picked by hand holds until `sessionId` changes. */
export default function useSessionScopeTab(sessionId) {
  const [tab, setTab] = useState(() => (sessionId ? 'session' : 'all'))

  useEffect(() => {
    setTab(sessionId ? 'session' : 'all')
  }, [sessionId])

  return [tab, setTab]
}
