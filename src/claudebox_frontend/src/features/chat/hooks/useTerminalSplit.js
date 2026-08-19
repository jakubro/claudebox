/** Terminal-split toggle + divider ratio - hydrated once per session, persisted via ui-state. */

import { useEffect, useRef, useState } from 'react'
import { getUiState, patchSessionUiState } from '../../../api/uiState'
import { CHAT_SPLIT_DEFAULT_RATIO } from '../../../config/dimensions'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../../config/timing'

/**
 * `split` stays `null` until hydration, so first paint renders nothing split-dependent rather than
 * flashing the default. Flat camelCase keys like `minimapPinned`; defaults: split off, ratio 0.5.
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
          enabled: data.session?.terminalSplitEnabled ?? false,
          ratio: data.session?.terminalSplitRatio ?? CHAT_SPLIT_DEFAULT_RATIO,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setSplit({ enabled: false, ratio: CHAT_SPLIT_DEFAULT_RATIO })
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

  /** Local state flips unconditionally; the persistence patch is fire-and-forget. */
  const toggleEnabled = () => {
    setSplit(prev => {
      if (!prev) {
        return prev
      }
      const next = { ...prev, enabled: !prev.enabled }
      if (sessionId) {
        patchSessionUiState(sessionId, [
          { op: 'set', path: 'terminalSplitEnabled', value: next.enabled },
        ])
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

  return { split, toggleEnabled, setRatio }
}
