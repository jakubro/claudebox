/** Tests for usePointerDragHandle - the pointer-capture drag primitive behind dividers. */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePointerDragHandle } from './usePointerDragHandle'

/** A stand-in for the DOM element a pointer handler's `e.currentTarget` would be. */
function fakeTarget() {
  const captured = new Set()
  return {
    setPointerCapture: vi.fn(id => captured.add(id)),
    releasePointerCapture: vi.fn(id => captured.delete(id)),
    hasPointerCapture: vi.fn(id => captured.has(id)),
  }
}

/** A minimal PointerEvent stand-in - jsdom's synthetic events don't reach these bare callbacks. */
function pointerEvent(target, { clientX = 0, clientY = 0, isPrimary = true, pointerId = 1 } = {}) {
  return { currentTarget: target, clientX, clientY, isPrimary, pointerId, preventDefault: vi.fn() }
}

describe('usePointerDragHandle', () => {
  it('starts a drag, captures the pointer, and reports the delta on move', () => {
    const onDragStart = vi.fn(() => ({ startValue: 10 }))
    const onDragMove = vi.fn()
    const { result } = renderHook(() =>
      usePointerDragHandle({ axis: 'x', onDragStart, onDragMove }),
    )
    const target = fakeTarget()

    const down = pointerEvent(target, { clientX: 100 })
    result.current.handlePointerDown(down)
    expect(target.setPointerCapture).toHaveBeenCalledWith(1)
    expect(down.preventDefault).toHaveBeenCalled()

    result.current.handlePointerMove(pointerEvent(target, { clientX: 130 }))
    expect(onDragMove).toHaveBeenCalledWith({ startValue: 10 }, 30, expect.anything())
  })

  it('reads clientY instead of clientX on the y axis', () => {
    const onDragMove = vi.fn()
    const { result } = renderHook(() =>
      usePointerDragHandle({ axis: 'y', onDragStart: () => ({}), onDragMove }),
    )
    const target = fakeTarget()

    result.current.handlePointerDown(pointerEvent(target, { clientX: 999, clientY: 50 }))
    result.current.handlePointerMove(pointerEvent(target, { clientX: 999, clientY: 80 }))

    expect(onDragMove).toHaveBeenCalledWith({}, 30, expect.anything())
  })

  it('ignores a non-primary pointer', () => {
    const onDragStart = vi.fn(() => ({}))
    const { result } = renderHook(() =>
      usePointerDragHandle({ axis: 'x', onDragStart, onDragMove: vi.fn() }),
    )

    result.current.handlePointerDown(pointerEvent(fakeTarget(), { isPrimary: false }))

    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('aborts before capturing the pointer when onDragStart returns null', () => {
    const { result } = renderHook(() =>
      usePointerDragHandle({ axis: 'x', onDragStart: () => null, onDragMove: vi.fn() }),
    )
    const target = fakeTarget()

    result.current.handlePointerDown(pointerEvent(target))

    expect(target.setPointerCapture).not.toHaveBeenCalled()
  })

  it('reports no move before a pointerdown has started a drag', () => {
    const onDragMove = vi.fn()
    const { result } = renderHook(() =>
      usePointerDragHandle({ axis: 'x', onDragStart: () => ({}), onDragMove }),
    )

    result.current.handlePointerMove(pointerEvent(fakeTarget(), { clientX: 500 }))

    expect(onDragMove).not.toHaveBeenCalled()
  })

  it('releases the pointer and ends the drag on pointer up', () => {
    const onDragMove = vi.fn()
    const { result } = renderHook(() =>
      usePointerDragHandle({ axis: 'x', onDragStart: () => ({}), onDragMove }),
    )
    const target = fakeTarget()

    result.current.handlePointerDown(pointerEvent(target, { clientX: 0 }))
    result.current.handlePointerUp(pointerEvent(target))
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1)

    result.current.handlePointerMove(pointerEvent(target, { clientX: 200 }))
    expect(onDragMove).not.toHaveBeenCalled()
  })

  it('does not release capture it never held', () => {
    const target = fakeTarget()
    const { result } = renderHook(() =>
      usePointerDragHandle({ axis: 'x', onDragStart: () => ({}), onDragMove: vi.fn() }),
    )

    result.current.handlePointerUp(pointerEvent(target))

    expect(target.releasePointerCapture).not.toHaveBeenCalled()
  })
})
