/** Open a session in a new browser tab at a jump target, flashing the item clicked. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { NEW_TAB_FLASH_MS } from '../config/timing'
import { useWorkspace } from '../context/WorkspaceContext'
import { openSessionInNewTab } from '../utils/navigation'

/** Return `{ openingKey, openInNewTab }`; the item flashes because window.open paints nothing. */
export default function useOpenInNewTab() {
  const { workspaceId } = useWorkspace()
  const [openingKey, setOpeningKey] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const openInNewTab = useCallback(
    (sessionId, itemKey, jumpOptions) => {
      if (!(workspaceId && sessionId)) {
        return
      }
      setOpeningKey(itemKey)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setOpeningKey(null), NEW_TAB_FLASH_MS)
      openSessionInNewTab(workspaceId, sessionId, jumpOptions)
    },
    [workspaceId],
  )

  return { openingKey, openInNewTab }
}
