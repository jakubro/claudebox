/** Nested context provider tree wrapping the application. */

import { AppActionsProvider } from '../../context/AppActionsContext'
import { BookmarksProvider } from '../../context/BookmarksContext'
import { BottomPanelsProvider } from '../../context/BottomPanelsContext'
import { ContainerMapProvider } from '../../context/ContainerMapContext'
import { DaemonStreamProvider } from '../../context/DaemonStreamContext'
import { EventsProvider } from '../../context/EventsContext'
import { InteractionProvider } from '../../context/InteractionContext'
import { LogsStreamProvider } from '../../context/LogsStreamContext'
import { SessionRoutingProvider } from '../../context/SessionRoutingContext'
import { SessionsProvider } from '../../context/SessionsContext'
import { StashProvider } from '../../context/StashContext'
import { StillRunningToastProvider } from '../../context/StillRunningToastContext'
import { WorkspaceProvider } from '../../context/WorkspaceContext'
import ContainerRecoveryEffect from './effects/ContainerRecoveryEffect'
import ContainerStatusEffect from './effects/ContainerStatusEffect'
import ContainerStopEffect from './effects/ContainerStopEffect'
import DaemonReconnectEffect from './effects/DaemonReconnectEffect'
import NewSessionBridge from './effects/NewSessionBridge'
import SessionDataBridge from './effects/SessionDataBridge'
import SessionRoutingEffect from './effects/SessionRoutingEffect'
import WorkspaceResetEffect from './effects/WorkspaceResetEffect'

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {object} props.jumpRefs - Refs for message jump navigation.
 * @param {React.RefObject} props.jumpRefs.prev - Jump-to-previous-message callback ref.
 * @param {React.RefObject} props.jumpRefs.next - Jump-to-next-message callback ref.
 * @param {React.RefObject} props.jumpRefs.top - Jump-to-top callback ref.
 * @param {React.RefObject} props.jumpRefs.bottom - Jump-to-bottom callback ref.
 * @param {object} props.panelCallbacks - Panel-level action callbacks.
 * @param {Function} props.panelCallbacks.onFocusChat - Focus the chat panel textarea.
 * @param {React.RefObject} props.panelCallbacks.panelSwitchingRef - Guard flag for scroll protection during panel activation.
 * @param {Function} props.panelCallbacks.onMaximizeToggle - Toggle panel group maximize.
 * @param {boolean} props.panelCallbacks.isMaximized - Whether a dockview group is currently maximized.
 * @param {Function} props.panelCallbacks.onClosePanel - Close a panel by ID.
 * @param {Function} props.panelCallbacks.onSessionAttach - Bind sessionIdRef and run the one-shot session-specific layout restore (consumed by SessionDataBridge).
 * @param {object} props.newSessionRefs - Refs for new-session callbacks (populated inside provider tree).
 * @param {React.RefObject} props.newSessionRefs.newSession - Create new session in current tab.
 * @param {React.RefObject} props.newSessionRefs.newSessionInNewTab - Create new session in new browser tab.
 * @param {object} props.scrollIntentRefs - Refs for cross-panel scroll-intent callbacks (populated by ChatPanel).
 * @param {React.RefObject} props.scrollIntentRefs.userIntent - markUserIntent callback ref.
 * @param {React.RefObject} props.scrollIntentRefs.programmaticScroll - markProgrammaticScroll callback ref.
 */
export default function AppProviders({
  children,
  jumpRefs,
  newSessionRefs,
  scrollIntentRefs,
  panelCallbacks,
}) {
  const { prev, next, top, bottom } = jumpRefs
  const { userIntent, programmaticScroll } = scrollIntentRefs
  const {
    onFocusChat,
    panelSwitchingRef,
    onMaximizeToggle,
    isMaximized,
    onClosePanel,
    onSessionAttach,
  } = panelCallbacks

  return (
    <AppActionsProvider
      onFocusChat={onFocusChat}
      panelSwitchingRef={panelSwitchingRef}
      onMaximizeToggle={onMaximizeToggle}
      isMaximized={isMaximized}
      onClosePanel={onClosePanel}
      jumpPrevRef={prev}
      jumpNextRef={next}
      jumpTopRef={top}
      jumpBottomRef={bottom}
      markUserIntentRef={userIntent}
      markProgrammaticScrollRef={programmaticScroll}>
      <WorkspaceProvider>
        <DaemonStreamProvider>
          <SessionsProvider>
            <ContainerMapProvider>
              <SessionRoutingProvider>
                <EventsProvider>
                  <LogsStreamProvider>
                    <InteractionProvider>
                      <SessionDataBridge onSessionAttach={onSessionAttach}>
                        <StillRunningToastProvider>
                          <NewSessionBridge refs={newSessionRefs} />
                          <BookmarksProvider>
                            <StashProvider>
                              <BottomPanelsProvider>
                                <ContainerRecoveryEffect />
                                <ContainerStatusEffect />
                                <ContainerStopEffect />
                                <DaemonReconnectEffect />
                                <WorkspaceResetEffect />
                                <SessionRoutingEffect />
                                {children}
                              </BottomPanelsProvider>
                            </StashProvider>
                          </BookmarksProvider>
                        </StillRunningToastProvider>
                      </SessionDataBridge>
                    </InteractionProvider>
                  </LogsStreamProvider>
                </EventsProvider>
              </SessionRoutingProvider>
            </ContainerMapProvider>
          </SessionsProvider>
        </DaemonStreamProvider>
      </WorkspaceProvider>
    </AppActionsProvider>
  )
}
