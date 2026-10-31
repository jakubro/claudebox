/** Manage dockview layout - refs, initialization, persistence, panel actions. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { patchSessionUiState } from '../../../api/uiState'
import { SIDE_PANEL_CONFIG } from '../../../config/layout'
import { LAYOUT_RESTORE_GRACE_MS, LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'
import { parseHash } from '../../../context/utils/sessionRouting'
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
  const savePendingRef = useRef(false)
  const graceTimeoutRef = useRef(null)
  const sessionIdRef = useRef(null)
  const layoutRestoredRef = useRef(false)
  const initialRestoreRef = useRef(null)
  const initialSessionIdRef = useRef(null)
  const [activePanels, setActivePanels] = useState([
    'sessions',
    'bookmarks',
    'boards',
    'todos',
    'stash',
    'tasks',
    'crons',
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

      const sessionId = parseHash(window.location.hash)?.sessionId ?? null
      initialSessionIdRef.current = sessionId
      let builtDefault = false
      graceTimeoutRef.current = setTimeout(() => {
        builtDefault = true
        buildDefaultLayout(api, sidePanel)
      }, LAYOUT_RESTORE_GRACE_MS)
      initialRestoreRef.current = restoreInitialLayout(sidePanel, sessionId).then(loaded => {
        clearTimeout(graceTimeoutRef.current)
        if (loaded) {
          updateActivePanels()
          // fromJSON restore creates groups via its own lifecycle - re-apply the marker so
          // MainPanel.css hides the tab bar.
          applyMainGroupMarker(api)
        } else if (!(builtDefault && api.getPanel('main'))) {
          // A failed fromJSON can leave panels behind; clear so the build hits no stale id.
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
            savePendingRef.current = true
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
   * Bind sessionIdRef (the layout save's target) and restore the session's own layout on first attach,
   * unless onReady already resolved it; a missing one is never rebuilt - that would remount the chat.
   * A layout change that settled before any session attached is saved here.
   */
  const onSessionAttach = useCallback(async sessionId => {
    sessionIdRef.current = sessionId
    const api = apiRef.current
    const sidePanel = sidePanelRef.current
    if (!api) {
      return
    }

    if (sessionId && !layoutRestoredRef.current && sidePanel) {
      layoutRestoredRef.current = true
      if (initialRestoreRef.current) {
        await initialRestoreRef.current
        initialRestoreRef.current = null
      }
      if (sessionId !== initialSessionIdRef.current) {
        await sidePanel.restoreFromServer(sessionId)
      }
    }

    if (sessionId && savePendingRef.current) {
      savePendingRef.current = false
      patchSessionUiState(sessionId, buildSaveOps(api, sidePanel, sidePanel.preMaximizeLayout))
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
      clearTimeout(graceTimeoutRef.current)
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

/**
 * Apply the URL session's saved layout, else the inherited one; false when neither applied. Each
 * restore replaces every panel, so nothing is built before the one that applies is known.
 */
async function restoreInitialLayout(sidePanel, sessionId) {
  if (sessionId && (await sidePanel.restoreFromServer(sessionId)).loaded) {
    return true
  }

  return (await sidePanel.restoreFromServer(null)).loaded
}
