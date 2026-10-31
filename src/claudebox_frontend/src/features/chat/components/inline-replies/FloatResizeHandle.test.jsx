/** Tests for FloatResizeHandle - the reply box's corner resize grip. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FloatResizeHandle from './FloatResizeHandle'

function renderHandle(overrides = {}) {
  const props = {
    id: 'r1',
    measure: () => ({ width: 560, bodyHeight: 100, maxWidth: 900 }),
    onResize: vi.fn(),
    onResizeStart: vi.fn(),
    onResizeEnd: vi.fn(),
    ...overrides,
  }
  render(<FloatResizeHandle {...props} />)
  const handle = screen.getByTestId('inline-float-resize')
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = vi.fn(() => true)
  handle.releasePointerCapture = vi.fn()

  return { handle, props }
}

const pointer = (x, y) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y })

describe('FloatResizeHandle', () => {
  it('grows width and body height with the pointer, reporting start and end', () => {
    const { handle, props } = renderHandle()

    fireEvent.pointerDown(handle, pointer(100, 100))
    fireEvent.pointerMove(handle, pointer(250, 160))
    fireEvent.pointerUp(handle, pointer(250, 160))

    expect(props.onResizeStart).toHaveBeenCalledWith('r1')
    expect(props.onResize).toHaveBeenLastCalledWith('r1', { width: 710, height: 160 })
    expect(props.onResizeEnd).toHaveBeenCalledWith('r1')
  })

  it('stops at the minimum width and body height', () => {
    const { handle, props } = renderHandle()

    fireEvent.pointerDown(handle, pointer(500, 500))
    fireEvent.pointerMove(handle, pointer(0, 0))

    expect(props.onResize).toHaveBeenLastCalledWith('r1', { width: 280, height: 60 })
  })

  it('never grows wider than the conversation allows', () => {
    const { handle, props } = renderHandle()

    fireEvent.pointerDown(handle, pointer(0, 0))
    fireEvent.pointerMove(handle, pointer(1000, 0))

    expect(props.onResize).toHaveBeenLastCalledWith('r1', { width: 900, height: 100 })
  })
})
