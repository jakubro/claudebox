/** Tests for useLocalStorage hook. */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useLocalStorage from './useLocalStorage'

// Stable references for defaults (prevent infinite re-renders)
const EMPTY_ARRAY = []
const EMPTY_OBJECT = {}
const DEFAULT_OBJECT = { current: '', history: {} }

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default value when key not in storage', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'))
    expect(result.current[0]).toBe('default')
  })

  it('returns stored value when key exists', () => {
    localStorage.setItem('test-key', JSON.stringify('stored-value'))
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'))
    expect(result.current[0]).toBe('stored-value')
  })

  it('returns stored array when key exists', () => {
    localStorage.setItem('test-key', JSON.stringify([1, 2, 3]))
    const { result } = renderHook(() => useLocalStorage('test-key', EMPTY_ARRAY))
    expect(result.current[0]).toEqual([1, 2, 3])
  })

  it('returns stored object when key exists', () => {
    localStorage.setItem('test-key', JSON.stringify({ foo: 'bar' }))
    const { result } = renderHook(() => useLocalStorage('test-key', EMPTY_OBJECT))
    expect(result.current[0]).toEqual({ foo: 'bar' })
  })

  it('updates state and persists on update()', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'))

    act(() => {
      result.current[1]('updated')
    })

    expect(result.current[0]).toBe('updated')
    expect(JSON.parse(localStorage.getItem('test-key'))).toBe('updated')
  })

  it('accepts updater function', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 5))

    act(() => {
      result.current[1](prev => prev + 1)
    })

    expect(result.current[0]).toBe(6)
  })

  it('removes from storage when value is empty array', () => {
    localStorage.setItem('test-key', JSON.stringify([1, 2, 3]))
    const { result } = renderHook(() => useLocalStorage('test-key', EMPTY_ARRAY))

    act(() => {
      result.current[1]([])
    })

    expect(localStorage.getItem('test-key')).toBeNull()
  })

  it('removes from storage when value is empty object', () => {
    localStorage.setItem('test-key', JSON.stringify({ foo: 'bar' }))
    const { result } = renderHook(() => useLocalStorage('test-key', EMPTY_OBJECT))

    act(() => {
      result.current[1]({})
    })

    expect(localStorage.getItem('test-key')).toBeNull()
  })

  it('handles null key (no persistence)', () => {
    const { result } = renderHook(() => useLocalStorage(null, 'default'))
    expect(result.current[0]).toBe('default')
  })

  it('updates state but does not persist with null key', () => {
    const { result } = renderHook(() => useLocalStorage(null, 'default'))

    act(() => {
      result.current[1]('updated')
    })

    expect(result.current[0]).toBe('updated')
    expect(localStorage.length).toBe(0)
  })

  it('reloads when key changes', () => {
    localStorage.setItem('key1', JSON.stringify('value1'))
    localStorage.setItem('key2', JSON.stringify('value2'))

    const { result, rerender } = renderHook(({ key }) => useLocalStorage(key, 'default'), {
      initialProps: { key: 'key1' },
    })

    expect(result.current[0]).toBe('value1')
    rerender({ key: 'key2' })
    expect(result.current[0]).toBe('value2')
  })

  it('returns default when new key has no stored value', () => {
    localStorage.setItem('key1', JSON.stringify('value1'))

    const { result, rerender } = renderHook(({ key }) => useLocalStorage(key, 'default'), {
      initialProps: { key: 'key1' },
    })

    expect(result.current[0]).toBe('value1')
    rerender({ key: 'key2' })
    expect(result.current[0]).toBe('default')
  })

  it('handles JSON parse errors gracefully', () => {
    localStorage.setItem('test-key', 'invalid-json{{{')
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'))
    expect(result.current[0]).toBe('default')
    expect(localStorage.getItem('test-key')).toBeNull()
  })

  it('supports custom isEmpty function', () => {
    const isEmpty = val => val.current === '' && Object.keys(val.history).length === 0

    const { result } = renderHook(() => useLocalStorage('test-key', DEFAULT_OBJECT, { isEmpty }))

    act(() => {
      result.current[1]({ current: 'hello', history: {} })
    })

    expect(localStorage.getItem('test-key')).not.toBeNull()

    act(() => {
      result.current[1]({ current: '', history: {} })
    })

    expect(localStorage.getItem('test-key')).toBeNull()
  })
})

describe('useLocalStorage debounce', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not write to localStorage immediately when debounceMs is set', () => {
    const { result } = renderHook(() =>
      useLocalStorage('debounce-key', 'initial', { debounceMs: 500 }),
    )

    act(() => {
      result.current[1]('debounced-value')
    })

    // State updates immediately
    expect(result.current[0]).toBe('debounced-value')

    // But localStorage is not written yet
    expect(localStorage.getItem('debounce-key')).toBeNull()
  })

  it('writes to localStorage after debounce delay elapses', () => {
    const { result } = renderHook(() =>
      useLocalStorage('debounce-key', 'initial', { debounceMs: 300 }),
    )

    act(() => {
      result.current[1]('delayed-value')
    })

    // Not written yet
    expect(localStorage.getItem('debounce-key')).toBeNull()

    // Advance past debounce delay
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(JSON.parse(localStorage.getItem('debounce-key'))).toBe('delayed-value')
  })

  it('resets debounce timer on rapid updates and only writes the last value', () => {
    const { result } = renderHook(() =>
      useLocalStorage('debounce-key', 'initial', { debounceMs: 200 }),
    )

    act(() => {
      result.current[1]('first')
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    act(() => {
      result.current[1]('second')
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    // Still not written (timer was reset)
    expect(localStorage.getItem('debounce-key')).toBeNull()

    act(() => {
      result.current[1]('third')
    })

    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Only the last value is persisted
    expect(JSON.parse(localStorage.getItem('debounce-key'))).toBe('third')
  })

  it('flush() writes pending debounced value immediately', () => {
    const { result } = renderHook(() =>
      useLocalStorage('debounce-key', 'initial', { debounceMs: 1000 }),
    )

    act(() => {
      result.current[1]('pending-value')
    })

    expect(localStorage.getItem('debounce-key')).toBeNull()

    // Call flush (third element of returned array)
    act(() => {
      result.current[2]()
    })

    expect(JSON.parse(localStorage.getItem('debounce-key'))).toBe('pending-value')
  })

  it('flush() clears the pending timeout', () => {
    const { result } = renderHook(() =>
      useLocalStorage('debounce-key', 'initial', { debounceMs: 500 }),
    )

    act(() => {
      result.current[1]('value-a')
    })

    // Flush immediately
    act(() => {
      result.current[2]()
    })

    expect(JSON.parse(localStorage.getItem('debounce-key'))).toBe('value-a')

    // Update again
    act(() => {
      result.current[1]('value-b')
    })

    // Advance past original timeout - should not double-write 'value-a'
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(JSON.parse(localStorage.getItem('debounce-key'))).toBe('value-b')
  })

  it('flush() is a no-op when there is no pending value', () => {
    const { result } = renderHook(() =>
      useLocalStorage('debounce-key', 'initial', { debounceMs: 500 }),
    )

    // Call flush with nothing pending - should not throw or write
    act(() => {
      result.current[2]()
    })

    expect(localStorage.getItem('debounce-key')).toBeNull()
  })

  it('clears pending timeout on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useLocalStorage('debounce-key', 'initial', { debounceMs: 500 }),
    )

    act(() => {
      result.current[1]('unmount-value')
    })

    // Unmount before timeout fires
    unmount()

    // Advance timers - timeout should have been cleared
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Value should not have been written
    expect(localStorage.getItem('debounce-key')).toBeNull()
  })

  it('writes immediately when debounceMs is 0', () => {
    const { result } = renderHook(() =>
      useLocalStorage('immediate-key', 'initial', { debounceMs: 0 }),
    )

    act(() => {
      result.current[1]('immediate-value')
    })

    // Written immediately with no delay
    expect(JSON.parse(localStorage.getItem('immediate-key'))).toBe('immediate-value')
  })
})
