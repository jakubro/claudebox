/** Context for the still-running toast - emit / dismiss / read current toast. */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const StillRunningToastContext = createContext(null)

/**
 * Provide the still-running toast state slot.
 *
 * Emit sites call `showStillRunningToast({ sessionId, sessionName, workspaceId })`
 * after navigating away from a session that was responding. DesktopLayout
 * subscribes to `toast` and renders the StillRunningToast component when set.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function StillRunningToastProvider({ children }) {
  const [toast, setToast] = useState(null)

  const showStillRunningToast = useCallback(info => setToast(info), [])
  const dismissStillRunningToast = useCallback(() => setToast(null), [])

  const value = useMemo(
    () => ({ toast, showStillRunningToast, dismissStillRunningToast }),
    [toast, showStillRunningToast, dismissStillRunningToast],
  )

  return (
    <StillRunningToastContext.Provider value={value}>{children}</StillRunningToastContext.Provider>
  )
}

/** Access the still-running toast state. */
export function useStillRunningToast() {
  const ctx = useContext(StillRunningToastContext)
  if (!ctx) {
    throw new Error('useStillRunningToast must be used within StillRunningToastProvider')
  }
  return ctx
}
