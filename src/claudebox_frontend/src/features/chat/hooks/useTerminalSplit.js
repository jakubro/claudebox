/** Right-slot view choice + divider ratio - hydrated once per session, persisted via ui-state. */

import { useEffect, useRef, useState } from 'react'
import { getUiState, patchSessionUiState } from '../../../api/uiState'
import { CHAT_SPLIT_DEFAULT_RATIO } from '../../../config/dimensions'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'
import { RightSlotView, resolveStoredRightSlotView } from '../utils/rightSlotViews'

/**
 * `split` stays `null` until hydration, so first paint renders nothing split-dependent rather than
 * flashing the default. `split.view` is a `RightSlotView` value, persisted as `rightSlotView`; a
 * stored `terminalSplitEnabled` boolean is read only as a fallback.
 */
export function useTerminalSplit(sessionId) {
  const [hydrated, setHydrated] = useState({ sessionId: null, split: null })
  const hydratedRef = useRef(hydrated)
  hydratedRef.current = hydrated
  const saveRatioTimeoutRef = useRef(null)
  const split = hydrated.sessionId === sessionId ? hydrated.split : null

  useEffect(() => {
    if (!sessionId || hydratedRef.current.sessionId === sessionId) {
      return undefined
    }
    let cancelled = false
    getUiState(sessionId)
      .then(data => {
        if (cancelled) {
          return
        }
        setHydrated({
          sessionId,
          split: {
            view: resolveStoredRightSlotView(data.session),
            ratio: data.session?.terminalSplitRatio ?? CHAT_SPLIT_DEFAULT_RATIO,
          },
        })
      })
      .catch(() => {
        if (!cancelled) {
          setHydrated({
            sessionId,
            split: { view: RightSlotView.FOCUSED, ratio: CHAT_SPLIT_DEFAULT_RATIO },
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    return () => {
      if (saveRatioTimeoutRef.current) {
        clearTimeout(saveRatioTimeoutRef.current)
      }
    }
  }, [])

  /** Local state selects unconditionally; the persistence patch is fire-and-forget. */
  const setView = view => {
    if (!split) {
      return
    }
    setHydrated(prev => ({ sessionId, split: { ...prev.split, view } }))
    patchSessionUiState(sessionId, [{ op: 'set', path: 'rightSlotView', value: view }])
  }

  /** Immediate locally for live drag visuals; persistence is debounced. */
  const setRatio = ratio => {
    if (!split) {
      return
    }
    setHydrated(prev => ({ sessionId, split: { ...prev.split, ratio } }))
    if (saveRatioTimeoutRef.current) {
      clearTimeout(saveRatioTimeoutRef.current)
    }
    saveRatioTimeoutRef.current = setTimeout(() => {
      saveRatioTimeoutRef.current = null
      patchSessionUiState(sessionId, [{ op: 'set', path: 'terminalSplitRatio', value: ratio }])
    }, LAYOUT_SAVE_DEBOUNCE_MS)
  }

  return { split, setView, setRatio }
}
