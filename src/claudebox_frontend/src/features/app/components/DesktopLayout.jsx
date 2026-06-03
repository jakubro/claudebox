/** Desktop layout — dockview panels, icon strips, footer, keyboard shortcuts, floating panels. */

import { useState } from 'react'
import AppProviders from '../AppProviders'
import useAppRefs from '../hooks/useAppRefs'
import useDockviewLayout from '../hooks/useDockviewLayout'
import DesktopLayoutBody from './DesktopLayoutBody'

/** Render the full desktop dockview layout with providers, panels, shortcuts, and floating panels. */
export default function DesktopLayout() {
  const [showHelpOverlay, setShowHelpOverlay] = useState(false)
  const { jumpRefs, newSessionRefs, scrollIntentRefs, newSessionRef, newSessionInNewTabRef } =
    useAppRefs()

  const {
    onReady,
    activePanels,
    isMaximized,
    handleTogglePanel,
    handleClosePanel,
    focusChatTab,
    panelSwitchingRef,
    onSessionAttach,
    handleMaximizeToggle,
    exitMaximize,
  } = useDockviewLayout()

  return (
    <AppProviders
      jumpRefs={jumpRefs}
      newSessionRefs={newSessionRefs}
      scrollIntentRefs={scrollIntentRefs}
      panelCallbacks={{
        onFocusChat: focusChatTab,
        panelSwitchingRef,
        onMaximizeToggle: handleMaximizeToggle,
        isMaximized,
        onClosePanel: handleClosePanel,
        onSessionAttach,
      }}>
      <DesktopLayoutBody
        onReady={onReady}
        activePanels={activePanels}
        isMaximized={isMaximized}
        onTogglePanel={handleTogglePanel}
        exitMaximize={exitMaximize}
        focusChatTab={focusChatTab}
        jumpRefs={jumpRefs}
        newSessionRef={newSessionRef}
        newSessionInNewTabRef={newSessionInNewTabRef}
        showHelpOverlay={showHelpOverlay}
        setShowHelpOverlay={setShowHelpOverlay}
      />
    </AppProviders>
  )
}
