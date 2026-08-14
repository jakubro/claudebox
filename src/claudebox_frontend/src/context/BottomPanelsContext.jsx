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
 * Hydrated and persisted via the /ui-state endpoint.
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
  // Distinguishes user changes (must persist) from hydration changes (must not echo back and
  // race the dockview layout PATCH).
  const userInteractedRef = useRef(false)

  // Resets per session so only that session's own interactions trigger persistence, not
  // hydration echoes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the change trigger; body only writes a ref
  useEffect(() => {
    userInteractedRef.current = false
  }, [sessionId])

  // Hydrates once per sessionId; welcome state (sessionId === null) skips it, so the strip stays
  // at defaults.
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

  // Declarative on purpose: one call states everything a side owns, so a same-ids re-run
  // produces no state change. Per-id register/unregister can't guarantee that - a
  // remove-then-readd is a new Map identity despite unchanged content, which re-renders every
  // consumer; if a consumer also renders the strip, that closes a loop and React aborts the tree.
  const setBottomPanelIds = useCallback((side, panelIds) => {
    setPanelSideMap(prev => {
      const next = new Map()
      for (const [id, existingSide] of prev) {
        if (existingSide !== side) {
          next.set(id, existingSide)
        }
      }
      for (const id of panelIds) {
        next.set(id, side)
      }

      return sameSideMap(prev, next) ? prev : next
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
      setBottomPanelIds,
      isBottomPanelId,
      togglePanel,
      closePanel,
      setHeight,
    }),
    [
      openSet,
      height,
      panelSideMap,
      setBottomPanelIds,
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

/** Test whether two panel-side maps hold the same ids on the same sides. */
function sameSideMap(a, b) {
  if (a.size !== b.size) {
    return false
  }
  for (const [id, side] of a) {
    if (b.get(id) !== side) {
      return false
    }
  }

  return true
}

/** Clamp a height value to [LOGS_STRIP_MIN_HEIGHT, LOGS_STRIP_MAX_HEIGHT_RATIO * viewport]. */
function clampHeight(h) {
  const max = Math.floor(window.innerHeight * LOGS_STRIP_MAX_HEIGHT_RATIO)
  return clamp(Math.round(h), LOGS_STRIP_MIN_HEIGHT, max)
}
