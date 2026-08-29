/** Desktop layout - dockview panels, icon strips, footer, keyboard shortcuts, floating panels. */

import { useState } from 'react'
import AppProviders from '../AppProviders'
import useAppRefs from '../hooks/useAppRefs'
import useDockviewLayout from '../hooks/useDockviewLayout'
import DesktopLayoutBody from './DesktopLayoutBody'

export default function DesktopLayout() {
  const [showHelpOverlay, setShowHelpOverlay] = useState(false)
  const {
    jumpRefs,
    rightColumnJumpRefs,
    railJumpRefs,
    newSessionRefs,
    scrollIntentRefs,
    newSessionRef,
    newSessionInNewTabRef,
    focusedGroupRootRef,
  } = useAppRefs()

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
  } = useDockviewLayout(focusedGroupRootRef)

  return (
    <AppProviders
      jumpRefs={jumpRefs}
      rightColumnJumpRefs={rightColumnJumpRefs}
      railJumpRefs={railJumpRefs}
      newSessionRefs={newSessionRefs}
      scrollIntentRefs={scrollIntentRefs}
      focusedGroupRootRef={focusedGroupRootRef}
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
        rightColumnJumpRefs={rightColumnJumpRefs}
        railJumpRefs={railJumpRefs}
        newSessionRef={newSessionRef}
        newSessionInNewTabRef={newSessionInNewTabRef}
        showHelpOverlay={showHelpOverlay}
        setShowHelpOverlay={setShowHelpOverlay}
      />
    </AppProviders>
  )
}
