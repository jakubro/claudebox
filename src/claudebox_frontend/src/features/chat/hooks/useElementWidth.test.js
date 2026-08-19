/** Tests for useElementWidth - live-measured element width via ResizeObserver. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import useElementWidth from './useElementWidth'

describe('useElementWidth', () => {
  it('is null before the ref has an element', () => {
    const ref = { current: null }
    const { result } = renderHook(() => useElementWidth(ref))

    expect(result.current).toBeNull()
  })

  it('reads clientWidth once the ref has an element', () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'clientWidth', { value: 640, configurable: true })
    const ref = { current: el }

    const { result } = renderHook(() => useElementWidth(ref))

    expect(result.current).toBe(640)
  })

  it('re-measures when the ref target changes across renders', () => {
    const first = document.createElement('div')
    Object.defineProperty(first, 'clientWidth', { value: 300, configurable: true })
    const second = document.createElement('div')
    Object.defineProperty(second, 'clientWidth', { value: 800, configurable: true })

    const { result, rerender } = renderHook(({ ref }) => useElementWidth(ref), {
      initialProps: { ref: { current: first } },
    })
    expect(result.current).toBe(300)

    rerender({ ref: { current: second } })
    expect(result.current).toBe(800)
  })
})
