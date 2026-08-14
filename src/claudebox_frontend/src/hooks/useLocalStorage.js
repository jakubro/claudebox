/** Generic localStorage hook with debouncing and scoped keys. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { reportError } from '../api/errorReport'

export default function useLocalStorage(key, defaultValue, options = {}) {
  const {
    debounceMs = 0,
    isEmpty = val =>
      Array.isArray(val)
        ? val.length === 0
        : typeof val === 'object' && val !== null && Object.keys(val).length === 0,
  } = options

  const [value, setValue] = useState(() => {
    if (!key) {
      return defaultValue
    }
    try {
      const stored = localStorage.getItem(key)
      return stored ? JSON.parse(stored) : defaultValue
    } catch (e) {
      console.warn('useLocalStorage: Failed to parse stored value, removing', e)
      _tryRemove(key)
      return defaultValue
    }
  })

  const timeoutRef = useRef(null)
  const pendingValueRef = useRef(null)
  // Set by update(); null after the key-change effect, whose value is already on disk.
  const toPersistRef = useRef(null)

  // Persist to localStorage. Never throws - a failed write (e.g. quota) just warns.
  const persist = useCallback(
    newValue => {
      if (!key) {
        return
      }
      try {
        if (isEmpty(newValue)) {
          localStorage.removeItem(key)
        } else {
          localStorage.setItem(key, JSON.stringify(newValue))
        }
      } catch (e) {
        console.warn('useLocalStorage: Failed to persist value - storage may be full', e)
        reportError({ kind: 'persistence-failure', message: `${key}: ${e?.message}` })
      }
      pendingValueRef.current = null
    },
    [key, isEmpty],
  )

  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (pendingValueRef.current !== null) {
      persist(pendingValueRef.current)
    }
  }, [persist])

  // Update stays pure; persistence runs in the effect below, never during React's render phase.
  const update = useCallback(newValueOrFn => {
    setValue(prev => {
      const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(prev) : newValueOrFn
      toPersistRef.current = { value: newValue }
      return newValue
    })
  }, [])

  // Persist only for update()-driven changes; toPersistRef is null after the key-change effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value retriggers after update() sets toPersistRef.
  useEffect(() => {
    if (toPersistRef.current === null) {
      return
    }
    const newValue = toPersistRef.current.value
    toPersistRef.current = null

    if (debounceMs > 0) {
      pendingValueRef.current = newValue
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => persist(newValue), debounceMs)
    } else {
      persist(newValue)
    }
  }, [value, debounceMs, persist])

  // Reload when key changes - clear immediately to prevent stale data
  useEffect(() => {
    setValue(defaultValue)
    if (!key) {
      return
    }
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        setValue(JSON.parse(stored))
      }
    } catch (e) {
      console.warn('useLocalStorage: Failed to parse stored value on key change, removing', e)
      _tryRemove(key)
    }
  }, [key, defaultValue])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return [value, update, flush]
}

/** Remove a key, swallowing a storage error rather than compounding a parse failure. */
function _tryRemove(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage inaccessible - state already resets to defaultValue at the call site.
  }
}
