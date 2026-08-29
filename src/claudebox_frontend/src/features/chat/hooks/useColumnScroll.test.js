/** Tests for useColumnScroll - listener reattachment and landing across an async mount. */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import useColumnScroll from './useColumnScroll'

describe('useColumnScroll', () => {
  it('attaches wheel listeners once the container mounts after isVisible flips true', () => {
    // Each column renders conditionally and always starts unmounted (the right-slot choice
    // hydrates async) - containerRef is null on this hook's own first commit, mirroring that.
    const { result, rerender } = renderHook(
      ({ isVisible }) => useColumnScroll('session-1', false, isVisible, 'terminal'),
      { initialProps: { isVisible: false } },
    )
    expect(result.current.isAutoScrollEnabled).toBe(true)

    // Simulates the column mounting: React attaches the ref during commit, before this hook's
    // own effects run - assigning it ahead of rerender() reproduces that ordering.
    const el = document.createElement('div')
    act(() => {
      result.current.containerRef.current = el
    })
    rerender({ isVisible: true })

    act(() => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    })

    expect(result.current.isAutoScrollEnabled).toBe(false)
  })

  it('does not attach listeners while the container has never mounted', () => {
    const { result } = renderHook(() => useColumnScroll('session-1', false, false, 'terminal'))

    const el = document.createElement('div')
    act(() => {
      result.current.containerRef.current = el
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    })

    // No listener was ever attached, so the wheel event has no effect on the latch.
    expect(result.current.isAutoScrollEnabled).toBe(true)
  })

  it('lands at the bottom when the column becomes visible mid-session, not only on a session change', () => {
    // A column turned on mid-session mounts a fresh container at offset zero and would otherwise
    // rely on a later append to carry it down, which a quiet session never sends.
    const { result, rerender } = renderHook(
      ({ isVisible }) => useColumnScroll('session-1', false, isVisible, 'work'),
      { initialProps: { isVisible: false } },
    )

    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true })
    act(() => {
      result.current.containerRef.current = el
      el.scrollTop = 0
    })

    rerender({ isVisible: true })

    expect(el.scrollTop).toBe(5000)
    expect(result.current.isAutoScrollEnabled).toBe(true)
  })

  it('keys the dev inspection global by columnKey, so two columns get two names', () => {
    renderHook(() => useColumnScroll('session-1', false, true, 'work'))
    renderHook(() => useColumnScroll('session-1', false, true, 'terminal'))

    expect(window.__work_scroll_controller__).toBeTruthy()
    expect(window.__terminal_scroll_controller__).toBeTruthy()
    expect(window.__work_scroll_controller__).not.toBe(window.__terminal_scroll_controller__)
  })
})
