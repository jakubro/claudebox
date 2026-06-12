/** App-container body - rendered inside AppProviders so children can consume provider-scoped contexts. */

import { DockviewReact } from 'dockview-react'
import { useCallback, useMemo } from 'react'
import { components, tabComponents } from '../../../config/layout'
import { useBottomPanels } from '../../../context/BottomPanelsContext'
import Footer from '../../footer'
import IconStrip from '../../icon-strip'
import FloatingPanel from '../../icon-strip/components/FloatingPanel'
import useFloatingPanel from '../../icon-strip/hooks/useFloatingPanel'
import BottomPanelContainer from '../../layout/BottomPanelContainer'
import FaviconEffect from '../effects/FaviconEffect'
import WorkspaceAccentEffect from '../effects/WorkspaceAccentEffect'
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts'
import HelpOverlay from './HelpOverlay'
import StillRunningToastSlot from './StillRunningToastSlot'

/**
 * App body inside AppProviders - owns dockview + icon strips + bottom panel.
 *
 * @param {object} props
 * @param {Function} props.onReady - Dockview onReady callback.
 * @param {string[]} props.activePanels - Panel IDs currently visible in dockview.
 * @param {boolean} props.isMaximized - Whether a dockview group is maximized.
 * @param {Function} props.onTogglePanel - Dockview-side toggle (intercepted for bottom-slot IDs).
 * @param {Function} props.exitMaximize - Exit maximized group; no-op when nothing is maximized.
 * @param {Function} props.focusChatTab - Focus the chat textarea.
 * @param {object} props.jumpRefs - Message-jump callback refs.
 * @param {React.RefObject} props.newSessionRef - New-session-in-current-tab ref.
 * @param {React.RefObject} props.newSessionInNewTabRef - New-session-in-new-browser-tab ref.
 * @param {boolean} props.showHelpOverlay - Help overlay visibility.
 * @param {Function} props.setShowHelpOverlay - Help overlay setter.
 */
export default function DesktopLayoutBody({
  onReady,
  activePanels,
  isMaximized,
  onTogglePanel,
  exitMaximize,
  focusChatTab,
  jumpRefs,
  newSessionRef,
  newSessionInNewTabRef,
  showHelpOverlay,
  setShowHelpOverlay,
}) {
  const { openSet, isBottomPanelId, togglePanel } = useBottomPanels()

  // Bottom-slot IDs route to BottomPanelsContext; everything else stays on dockview.
  const handleTogglePanel = useCallback(
    id => {
      if (isBottomPanelId(id)) {
        if (isMaximized) {
          exitMaximize()
          if (!openSet.has(id)) {
            togglePanel(id)
          }
          return
        }
        togglePanel(id)
        return
      }
      onTogglePanel(id)
    },
    [onTogglePanel, isBottomPanelId, togglePanel, isMaximized, exitMaximize, openSet],
  )

  // Bottom-slot panel icons highlight as active alongside dockview's active panels.
  const augmentedActivePanels = useMemo(
    () => (openSet.size > 0 ? [...activePanels, ...openSet] : activePanels),
    [activePanels, openSet],
  )

  useKeyboardShortcuts({
    handleTogglePanel,
    focusChatTab,
    showHelpOverlay,
    setShowHelpOverlay,
    jumpPrevRef: jumpRefs.prev,
    jumpNextRef: jumpRefs.next,
    jumpTopRef: jumpRefs.top,
    jumpBottomRef: jumpRefs.bottom,
    onNewSession: () => newSessionRef.current?.(),
    onNewSessionInNewTab: () => newSessionInNewTabRef.current?.(),
  })

  const {
    hoveredPanelId,
    anchorRect,
    floatingPosition,
    handleIconEnter,
    handleIconLeave,
    handlePanelEnter,
    handlePanelLeave,
    dismiss: dismissFloatingPanel,
  } = useFloatingPanel(isMaximized, augmentedActivePanels)

  return (
    <div className="app-container">
      <IconStrip
        position="left"
        panels={['sessions']}
        bottomPanels={['containers']}
        activePanels={augmentedActivePanels}
        onTogglePanel={handleTogglePanel}
        onIconEnter={handleIconEnter}
        onIconLeave={handleIconLeave}
      />
      <div className="dockview-container">
        <DockviewReact
          className="dockview-theme-dark"
          onReady={onReady}
          components={components}
          tabComponents={tabComponents}
        />
      </div>
      <IconStrip
        position="right"
        panels={[
          'todos',
          'stash',
          'tasks',
          'bookmarks',
          'boards',
          'usage',
          'mcp',
          'commands',
          'help',
        ]}
        bottomPanels={['logs']}
        activePanels={augmentedActivePanels}
        onTogglePanel={handleTogglePanel}
        onIconEnter={handleIconEnter}
        onIconLeave={handleIconLeave}
      />
      <Footer />
      <BottomPanelContainer />
      <WorkspaceAccentEffect />
      <FaviconEffect />
      <StillRunningToastSlot />
      {showHelpOverlay && <HelpOverlay onClose={() => setShowHelpOverlay(false)} />}
      {hoveredPanelId && (
        <FloatingPanel
          panelId={hoveredPanelId}
          anchorRect={anchorRect}
          position={floatingPosition}
          onMouseEnter={handlePanelEnter}
          onMouseLeave={handlePanelLeave}
          onDismiss={dismissFloatingPanel}
        />
      )}
    </div>
  )
}
