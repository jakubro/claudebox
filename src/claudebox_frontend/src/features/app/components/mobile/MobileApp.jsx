/** Mobile app shell — wraps AppProviders with no-op dockview callbacks around MobileLayout. */

import { useRef } from 'react'
import { noop } from '../../../../utils/noop'
import AppProviders from '../../AppProviders'
import useAppRefs from '../../hooks/useAppRefs'
import MobileLayout from './MobileLayout'

/** Render mobile layout inside shared providers with no-op panel callbacks. */
export default function MobileApp() {
  const { jumpRefs, newSessionRefs, scrollIntentRefs } = useAppRefs()
  const panelSwitchingRef = useRef(false)

  return (
    <AppProviders
      jumpRefs={jumpRefs}
      newSessionRefs={newSessionRefs}
      scrollIntentRefs={scrollIntentRefs}
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
