/** Tests for ChatSplitDivider - the draggable transcript/terminal divider. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CHAT_TERMINAL_MIN_WIDTH, CHAT_TRANSCRIPT_MIN_WIDTH } from '../../../config/dimensions'
import ChatSplitDivider from './ChatSplitDivider'

/** Renders the divider in a `.chat-content-area` with a stubbed width (jsdom reports 0). */
function renderDivider(props, width = 1000) {
  const utils = render(
    <div className="chat-content-area" data-testid="content-area">
      <ChatSplitDivider ratio={0.5} onRatioChange={vi.fn()} {...props} />
    </div>,
  )
  Object.defineProperty(screen.getByTestId('content-area'), 'clientWidth', {
    value: width,
    configurable: true,
  })
  return utils
}

/** jsdom's synthetic PointerEvent defaults isPrimary to false - isPrimaryPointer() needs it set. */
function startDrag(handle, clientX) {
  fireEvent.pointerDown(handle, { pointerId: 1, clientX, isPrimary: true })
}

describe('ChatSplitDivider', () => {
  it('renders as a vertical separator with the ratio as a percent', () => {
    renderDivider({ ratio: 0.4 })

    const handle = screen.getByTestId('chat-split-divider')
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '40')
    expect(handle).toHaveAttribute('aria-valuemin', '0')
    expect(handle).toHaveAttribute('aria-valuemax', '100')
  })

  it('reports a dragged ratio via onRatioChange', () => {
    const onRatioChange = vi.fn()
    renderDivider({ onRatioChange }, 1000)

    const handle = screen.getByTestId('chat-split-divider')
    startDrag(handle, 500)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 })

    expect(onRatioChange).toHaveBeenCalledOnce()
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(0.6, 5)
  })

  it('does not report a move before a pointerdown has started a drag', () => {
    const onRatioChange = vi.fn()
    renderDivider({ onRatioChange }, 1000)

    fireEvent.pointerMove(screen.getByTestId('chat-split-divider'), { pointerId: 1, clientX: 600 })

    expect(onRatioChange).not.toHaveBeenCalled()
  })

  it('clamps the ratio so the transcript column keeps its minimum width', () => {
    const onRatioChange = vi.fn()
    renderDivider({ ratio: 0.5, onRatioChange }, 1000)

    const handle = screen.getByTestId('chat-split-divider')
    startDrag(handle, 500)
    // Drag far left - would put the transcript column below its floor.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -5000 })

    const minRatio = CHAT_TRANSCRIPT_MIN_WIDTH / 1000
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(minRatio, 5)
  })

  it('clamps the ratio so the terminal column keeps its minimum width', () => {
    const onRatioChange = vi.fn()
    renderDivider({ ratio: 0.5, onRatioChange }, 1000)

    const handle = screen.getByTestId('chat-split-divider')
    startDrag(handle, 500)
    // Drag far right - would put the terminal column below its floor.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5000 })

    const maxRatio = 1 - CHAT_TERMINAL_MIN_WIDTH / 1000
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(maxRatio, 5)
  })

  it('stops reporting moves after pointerup ends the drag', () => {
    const onRatioChange = vi.fn()
    renderDivider({ onRatioChange }, 1000)

    const handle = screen.getByTestId('chat-split-divider')
    startDrag(handle, 500)
    fireEvent.pointerUp(handle, { pointerId: 1 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 })

    expect(onRatioChange).not.toHaveBeenCalled()
  })
})
