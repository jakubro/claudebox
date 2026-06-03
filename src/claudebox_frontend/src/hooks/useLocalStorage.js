/** Generic localStorage hook with debouncing and scoped keys. */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Manage localStorage state with debounced persistence and scoped keys. */
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
      localStorage.removeItem(key)
      return defaultValue
    }
  })

  const timeoutRef = useRef(null)
  const pendingValueRef = useRef(null)

  // Persist to localStorage
  const persist = useCallback(
    newValue => {
      if (!key) {
        return
      }
      if (isEmpty(newValue)) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, JSON.stringify(newValue))
      }
      pendingValueRef.current = null
    },
    [key, isEmpty],
  )

  // Flush any pending debounced write immediately
  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (pendingValueRef.current !== null) {
      persist(pendingValueRef.current)
    }
  }, [persist])

  // Update state and persist (with optional debounce)
  const update = useCallback(
    newValueOrFn => {
      setValue(prev => {
        const newValue = typeof newValueOrFn === 'function' ? newValueOrFn(prev) : newValueOrFn

        if (debounceMs > 0) {
          pendingValueRef.current = newValue
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
          }
          timeoutRef.current = setTimeout(() => persist(newValue), debounceMs)
        } else {
          persist(newValue)
        }

        return newValue
      })
    },
    [debounceMs, persist],
  )

  // Reload when key changes - clear immediately to prevent stale data
  useEffect(() => {
    setValue(defaultValue) // Clear immediately on key change
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
      localStorage.removeItem(key)
    }
  }, [key, defaultValue])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return [value, update, flush]
}
