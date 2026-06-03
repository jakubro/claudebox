/** Bottom-panel slot state (open set + shared strip height), persisted per session. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getUiState, patchSessionUiState } from '../api/uiState'
import {
  LOGS_STRIP_DEFAULT_HEIGHT,
  LOGS_STRIP_MAX_HEIGHT_RATIO,
  LOGS_STRIP_MIN_HEIGHT,
} from '../config/dimensions'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../config/timing'
import { clamp } from '../utils/clamp'
import { useSessionId } from './SessionDataContext'

const BottomPanelsContext = createContext(null)

/**
 * Bottom-panel slot state per session — open set + shared strip height; hydrated/persisted via /ui-state.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function BottomPanelsProvider({ children }) {
  const sessionId = useSessionId()
  const [openSet, setOpenSet] = useState(() => new Set())
  const [height, setHeightState] = useState(LOGS_STRIP_DEFAULT_HEIGHT)
  const [panelSideMap, setPanelSideMap] = useState(() => new Map())

  const hydratedSessionRef = useRef(null)
  const saveTimeoutRef = useRef(null)
  // Distinguishes user-initiated state changes (which must persist) from
  // hydration-initiated state changes (which must not echo back and race
  // the dockview layout PATCH).
  const userInteractedRef = useRef(false)

  // Reset the user-interaction flag whenever the active session changes —
  // the new session needs its own interactions to trigger persistence.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the change trigger; body only writes a ref
  useEffect(() => {
    userInteractedRef.current = false
  }, [sessionId])

  // Hydrate from server once per sessionId. Welcome state (sessionId === null)
  // skips hydration; the strip stays at defaults until a session attaches.
  useEffect(() => {
    if (!sessionId || hydratedSessionRef.current === sessionId) {
      return
    }
    hydratedSessionRef.current = sessionId
    let cancelled = false
    getUiState(sessionId)
      .then(data => {
        if (cancelled) {
          return
        }
        const stored = data?.session?.bottomPanels
        if (stored && typeof stored === 'object') {
          if (Array.isArray(stored.openSet)) {
            setOpenSet(new Set(stored.openSet))
          }
          if (typeof stored.height === 'number' && stored.height > 0) {
            setHeightState(clampHeight(stored.height))
          }
        }
      })
      .catch(() => {
        // Best-effort hydration; defaults are already in state.
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Debounced PATCH on user-initiated changes only.
  useEffect(() => {
    if (!(sessionId && userInteractedRef.current)) {
      return
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      patchSessionUiState(sessionId, [
        {
          op: 'set',
          path: 'bottomPanels',
          value: { openSet: [...openSet], height },
        },
      ])
    }, LAYOUT_SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
    }
  }, [sessionId, openSet, height])

  const registerBottomPanel = useCallback((panelId, side) => {
    setPanelSideMap(prev => {
      if (prev.get(panelId) === side) {
        return prev
      }
      const next = new Map(prev)
      next.set(panelId, side)
      return next
    })
  }, [])

  const unregisterBottomPanel = useCallback(panelId => {
    setPanelSideMap(prev => {
      if (!prev.has(panelId)) {
        return prev
      }
      const next = new Map(prev)
      next.delete(panelId)
      return next
    })
  }, [])

  const isBottomPanelId = useCallback(panelId => panelSideMap.has(panelId), [panelSideMap])

  const togglePanel = useCallback(panelId => {
    userInteractedRef.current = true
    setOpenSet(prev => {
      const next = new Set(prev)
      if (next.has(panelId)) {
        next.delete(panelId)
      } else {
        next.add(panelId)
      }
      return next
    })
  }, [])

  const closePanel = useCallback(panelId => {
    userInteractedRef.current = true
    setOpenSet(prev => {
      if (!prev.has(panelId)) {
        return prev
      }
      const next = new Set(prev)
      next.delete(panelId)
      return next
    })
  }, [])

  const setHeight = useCallback(h => {
    userInteractedRef.current = true
    setHeightState(clampHeight(h))
  }, [])

  const value = useMemo(
    () => ({
      openSet,
      height,
      panelSideMap,
      registerBottomPanel,
      unregisterBottomPanel,
      isBottomPanelId,
      togglePanel,
      closePanel,
      setHeight,
    }),
    [
      openSet,
      height,
      panelSideMap,
      registerBottomPanel,
      unregisterBottomPanel,
      isBottomPanelId,
      togglePanel,
      closePanel,
      setHeight,
    ],
  )

  return <BottomPanelsContext.Provider value={value}>{children}</BottomPanelsContext.Provider>
}

/** Access bottom-panel slot state and actions. */
export function useBottomPanels() {
  const context = useContext(BottomPanelsContext)
  if (!context) {
    throw new Error('useBottomPanels must be used within BottomPanelsProvider')
  }
  return context
}

/** Clamp a height value to [LOGS_STRIP_MIN_HEIGHT, LOGS_STRIP_MAX_HEIGHT_RATIO * viewport]. */
function clampHeight(h) {
  const max = Math.floor(window.innerHeight * LOGS_STRIP_MAX_HEIGHT_RATIO)
  return clamp(Math.round(h), LOGS_STRIP_MIN_HEIGHT, max)
}
