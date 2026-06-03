/** Manage dockview layout — refs, initialization, persistence, panel actions. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { patchSessionUiState } from '../../../api/uiState'
import { SIDE_PANEL_CONFIG } from '../../../config/layout'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'
import SidePanelManager from '../../../managers/SidePanelManager'
import { buildSaveOps } from '../../../utils/layoutPersistence'
import { applyMainGroupMarker, buildDefaultLayout } from '../utils/default-layout'

export default function useDockviewLayout() {
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
      setActivePanels([
        ...manager.state.left.order,
        ...manager.state.right.order,
        ...manager.state.bottom.order,
      ])
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
          // fromJSON restore creates groups via its own lifecycle — re-apply
          // the data-main-group marker so MainPanel.css hides the tab bar.
          applyMainGroupMarker(api)
        } else if (api.panels.length === 0) {
          // fromJSON.clear() may have destroyed panels before the restore failed — rebuild
          buildDefaultLayout(api, sidePanel)
        }
      })

      // onDidAddGroup fires on fromJSON deserialization, drag-creates-new-group,
      // and programmatic createGroup. Re-apply the data-main-group marker so
      // returning users (who load via restoreFromServer + fromJSON, bypassing
      // buildDefaultLayout) see the main panel without a tab bar at first paint.
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

      // Maximize/minimize fires a separate event — not onDidLayoutChange
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

  // Guard flag shared with AppActionsContext — prevents scroll callbacks from
  // clobbering saved position when setActive() triggers a browser scroll reset.
  const panelSwitchingRef = useRef(false)

  const focusChatTab = useCallback(() => {
    panelSwitchingRef.current = true

    // Snapshot scroll position from DOM before any internal layout reflow can reset it.
    const messagesEl = document.querySelector('.chat-messages')
    const savedScrollTop = messagesEl?.scrollTop ?? 0

    requestAnimationFrame(() => {
      if (messagesEl && savedScrollTop > 0) {
        messagesEl.scrollTop = savedScrollTop
      }
      // Defer focus to second rAF so it runs after dockview's internal
      // post-layout focus management settles.
      requestAnimationFrame(() => {
        document.querySelector('.chat-input textarea')?.focus({ preventScroll: true })
        panelSwitchingRef.current = false
      })
    })
  }, [])

  /**
   * Bind sessionIdRef and run the one-shot per-tab session-specific layout
   * restore the first time a real session attaches. The save path inside
   * onDidLayoutChange consults sessionIdRef to know which session to PATCH
   * on layout changes, so this binding is required for layout persistence.
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
      const { loaded } = await sidePanel.restoreFromServer(sessionId)
      if (!loaded && api.panels.length === 0) {
        buildDefaultLayout(api, sidePanel)
      }
    }
  }, [])

  const handleMaximizeToggle = useCallback(groupApi => {
    sidePanelRef.current?.maximizeToggle(groupApi)
  }, [])

  const exitMaximize = useCallback(() => {
    sidePanelRef.current?.exitMaximize()
  }, [])

  // Cleanup save timeout on unmount
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
