/** Mobile app shell - wraps AppProviders with no-op dockview callbacks around MobileLayout. */

import { useRef } from 'react'
import { noop } from '../../../../utils/noop'
import AppProviders from '../../AppProviders'
import useAppRefs from '../../hooks/useAppRefs'
import MobileLayout from './MobileLayout'

export default function MobileApp() {
  const {
    jumpRefs,
    rightColumnJumpRefs,
    newSessionRefs,
    scrollIntentRefs,
    railJumpRefs,
    focusedGroupRootRef,
  } = useAppRefs()
  const panelSwitchingRef = useRef(false)

  return (
    <AppProviders
      jumpRefs={jumpRefs}
      rightColumnJumpRefs={rightColumnJumpRefs}
      newSessionRefs={newSessionRefs}
      scrollIntentRefs={scrollIntentRefs}
      railJumpRefs={railJumpRefs}
      focusedGroupRootRef={focusedGroupRootRef}
      panelCallbacks={{
        onFocusChat: noop,
        panelSwitchingRef,
        onMaximizeToggle: noop,
        onClosePanel: noop,
        onSessionAttach: noop,
      }}>
      <MobileLayout />
    </AppProviders>
  )
}
