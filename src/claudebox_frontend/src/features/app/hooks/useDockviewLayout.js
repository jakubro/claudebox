/** Manage dockview layout - refs, initialization, persistence, panel actions. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { patchSessionUiState } from '../../../api/uiState'
import { SIDE_PANEL_CONFIG } from '../../../config/layout'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'
import SidePanelManager from '../../../managers/SidePanelManager'
import { buildSaveOps } from '../../../utils/layoutPersistence'
import { applyMainGroupMarker, buildDefaultLayout } from '../utils/default-layout'

/**
 * @param {React.RefObject} [focusedGroupRootRef] - Focused rail group's root DOM node, scoping the
 *   `.chat-messages` snapshot below; defaults to `document` when absent, as on mobile.
 */
export default function useDockviewLayout(focusedGroupRootRef) {
  const apiRef = useRef(null)
  const sidePanelRef = useRef(null)
  const saveTimeoutRef = useRef(null)
  const sessionIdRef = useRef(null)
  const layoutRestoredRef = useRef(false)
  const initialRestoreRef = useRef(null)
  const [activePanels, setActivePanels] = useState([
    'sessions',
    'bookmarks',
    'boards',
    'todos',
    'stash',
    'tasks',
  ])
  const [isMaximized, setIsMaximized] = useState(false)

  const updateActivePanels = useCallback(() => {
    const manager = sidePanelRef.current
    if (manager) {
      setActivePanels([...manager.state.left.order, ...manager.state.right.order])
    }
  }, [])

  const onReady = useCallback(
    event => {
      apiRef.current = event.api
      const api = event.api

      const sidePanel = new SidePanelManager(api, SIDE_PANEL_CONFIG)
      sidePanelRef.current = sidePanel

      buildDefaultLayout(api, sidePanel)

      initialRestoreRef.current = sidePanel.restoreFromServer(null).then(({ loaded }) => {
        if (loaded) {
          updateActivePanels()
          // fromJSON restore creates groups via its own lifecycle - re-apply the marker so
          // MainPanel.css hides the tab bar.
          applyMainGroupMarker(api)
        } else {
          // A failed fromJSON can leave panels behind; clear so the rebuild hits no stale id.
          api.clear()
          buildDefaultLayout(api, sidePanel)
        }
      })

      // onDidAddGroup fires on fromJSON deserialization, drag-create, and programmatic createGroup -
      // re-apply the data-main-group marker so returning users see the main panel without a tab bar.
      api.onDidAddGroup(() => {
        applyMainGroupMarker(api)
      })

      api.onDidMovePanel(e => {
        sidePanel.handlePanelMove(e.panel)
        // A panel moving between groups changes which group is "main-only".
        applyMainGroupMarker(api)
      })

      api.onDidLayoutChange(() => {
        sidePanel.updateDimensions()
        updateActivePanels()
        setIsMaximized(api.hasMaximizedGroup())

        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        saveTimeoutRef.current = setTimeout(() => {
          const sessionId = sessionIdRef.current
          if (!sessionId) {
            return
          }
          patchSessionUiState(sessionId, buildSaveOps(api, sidePanel, sidePanel.preMaximizeLayout))
        }, LAYOUT_SAVE_DEBOUNCE_MS)
      })

      // Maximize/minimize fires a separate event - not onDidLayoutChange
      api.onDidMaximizedGroupChange(() => {
        setIsMaximized(api.hasMaximizedGroup())
      })
    },
    [updateActivePanels],
  )

  const handleTogglePanel = useCallback(panelId => {
    sidePanelRef.current?.toggle(panelId)
  }, [])

  const handleClosePanel = useCallback(panelId => {
    sidePanelRef.current?.close(panelId)
  }, [])

  // Guard flag shared with AppActionsContext - prevents scroll callbacks from clobbering saved
  // position when setActive() triggers a browser scroll reset.
  const panelSwitchingRef = useRef(false)

  const focusChatTab = useCallback(() => {
    panelSwitchingRef.current = true

    // Snapshot scroll position from DOM before any internal layout reflow can reset it.
    const messagesEl = (focusedGroupRootRef?.current ?? document).querySelector('.chat-messages')
    const savedScrollTop = messagesEl?.scrollTop ?? 0

    requestAnimationFrame(() => {
      if (messagesEl && savedScrollTop > 0) {
        messagesEl.scrollTop = savedScrollTop
      }
      // Defer focus to second rAF so it runs after dockview's internal post-layout focus management settles.
      requestAnimationFrame(() => {
        document.querySelector('.chat-input textarea')?.focus({ preventScroll: true })
        panelSwitchingRef.current = false
      })
    })
  }, [focusedGroupRootRef])

  /**
   * Bind sessionIdRef and run the one-shot per-tab layout restore on first session attach; the
   * onDidLayoutChange save path reads sessionIdRef to know which session to PATCH.
   *
   * A missing per-session layout is not rebuilt here: onReady already applied the inherited one,
   * and rebuilding would tear down the panel holding a just-created session's first message.
   */
  const onSessionAttach = useCallback(async sessionId => {
    const api = apiRef.current
    const sidePanel = sidePanelRef.current
    if (!api) {
      return
    }

    sessionIdRef.current = sessionId

    if (sessionId && !layoutRestoredRef.current && sidePanel) {
      layoutRestoredRef.current = true
      if (initialRestoreRef.current) {
        await initialRestoreRef.current
        initialRestoreRef.current = null
      }
      await sidePanel.restoreFromServer(sessionId)
    }
  }, [])

  const handleMaximizeToggle = useCallback(groupApi => {
    sidePanelRef.current?.maximizeToggle(groupApi)
  }, [])

  const exitMaximize = useCallback(() => {
    sidePanelRef.current?.exitMaximize()
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  return {
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
  }
}
