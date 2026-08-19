/** Tests for useBottomAutoscroll - at-bottom-only autoscroll shared by log/entry lists. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useBottomAutoscroll } from './useBottomAutoscroll'

/** A jsdom div with scrollHeight/clientHeight stubbed - jsdom never computes real layout. */
function attachScrollable(ref, { scrollHeight = 1000, clientHeight = 200, scrollTop = 0 } = {}) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  el.scrollTop = scrollTop
  ref.current = el
  return el
}

describe('useBottomAutoscroll', () => {
  it('scrolls to bottom when content changes while still at the bottom', () => {
    const { result, rerender } = renderHook(({ content }) => useBottomAutoscroll(content), {
      initialProps: { content: [1] },
    })
    const el = attachScrollable(result.current.scrollRef)

    rerender({ content: [1, 2] })

    expect(el.scrollTop).toBe(1000)
  })

  it('does not scroll when the user has scrolled away from the bottom', () => {
    const { result, rerender } = renderHook(({ content }) => useBottomAutoscroll(content), {
      initialProps: { content: [1] },
    })
    const el = attachScrollable(result.current.scrollRef, { scrollTop: 0 })

    result.current.handleScroll()
    rerender({ content: [1, 2] })

    expect(el.scrollTop).toBe(0)
  })

  it('re-enables autoscroll once the user scrolls back near the bottom', () => {
    const { result, rerender } = renderHook(({ content }) => useBottomAutoscroll(content), {
      initialProps: { content: [1] },
    })
    const el = attachScrollable(result.current.scrollRef, { scrollTop: 0 })
    result.current.handleScroll()

    el.scrollTop = 750 // scrollHeight(1000) - clientHeight(200) - 50, within AUTOSCROLL_THRESHOLD
    result.current.handleScroll()
    rerender({ content: [1, 2] })

    expect(el.scrollTop).toBe(1000)
  })

  it('does nothing when the ref has not mounted yet', () => {
    const { rerender } = renderHook(({ content }) => useBottomAutoscroll(content), {
      initialProps: { content: [1] },
    })

    expect(() => rerender({ content: [1, 2] })).not.toThrow()
  })
})
