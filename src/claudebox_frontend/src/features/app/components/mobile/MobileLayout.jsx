/** Mobile layout shell - single-column chat with top bar, status strip, drawer, and details sheet. */

import { useCallback, useMemo, useState } from 'react'
import ChatPanel from '../../../chat'
import DetailsSheet from './DetailsSheet'
import MobileDrawer from './MobileDrawer'
import { MobileMenuProvider } from './MobileMenuContext'
import MobileTopBar from './MobileTopBar'
import StatusStrip from './StatusStrip'

/** Render single-column mobile layout with drawer and details sheet overlays. */
export default function MobileLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const openDetails = useCallback(() => setDetailsOpen(true), [])
  const closeDetails = useCallback(() => setDetailsOpen(false), [])
  const toggleDetails = useCallback(() => setDetailsOpen(prev => !prev), [])

  const menuValue = useMemo(
    () => ({ openDrawer, closeDrawer, openDetails, closeDetails }),
    [openDrawer, closeDrawer, openDetails, closeDetails],
  )

  return (
    <MobileMenuProvider value={menuValue}>
      <div className="mobile-layout">
        <MobileTopBar
          onHamburger={openDrawer}
          onToggleDetails={toggleDetails}
          detailsOpen={detailsOpen}
        />
        <StatusStrip />
        {detailsOpen && <DetailsSheet onClose={closeDetails} />}
        <div className="mobile-chat-area">
          <ChatPanel />
        </div>
        {drawerOpen && <MobileDrawer onClose={closeDrawer} />}
      </div>
    </MobileMenuProvider>
  )
}
