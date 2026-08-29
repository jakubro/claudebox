/** Right-slot view choice + divider ratio - hydrated once per session, persisted via ui-state. */

import { useEffect, useRef, useState } from 'react'
import { getUiState, patchSessionUiState } from '../../../api/uiState'
import { CHAT_SPLIT_DEFAULT_RATIO } from '../../../config/dimensions'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'
import { RightSlotView, resolveStoredRightSlotView } from '../utils/rightSlotViews'

/**
 * `split` stays `null` until hydration, so first paint renders nothing split-dependent rather than
 * flashing the default. `split.view` is a `RightSlotView` value (or `OFF`), persisted as
 * `rightSlotView`; a stored `terminalSplitEnabled` boolean is read only as a fallback.
 */
export function useTerminalSplit(sessionId) {
  const [split, setSplit] = useState(null)
  const saveRatioTimeoutRef = useRef(null)

  useEffect(() => {
    setSplit(null)
    if (!sessionId) {
      return undefined
    }
    let cancelled = false
    getUiState(sessionId)
      .then(data => {
        if (cancelled) {
          return
        }
        setSplit({
          view: resolveStoredRightSlotView(data.session),
          ratio: data.session?.terminalSplitRatio ?? CHAT_SPLIT_DEFAULT_RATIO,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setSplit({ view: RightSlotView.OFF, ratio: CHAT_SPLIT_DEFAULT_RATIO })
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
    setSplit(prev => {
      if (!prev) {
        return prev
      }
      const next = { ...prev, view }
      if (sessionId) {
        patchSessionUiState(sessionId, [{ op: 'set', path: 'rightSlotView', value: next.view }])
      }
      return next
    })
  }

  /** Immediate locally for live drag visuals; persistence is debounced. */
  const setRatio = ratio => {
    setSplit(prev => (prev ? { ...prev, ratio } : prev))
    if (!sessionId) {
      return
    }
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
