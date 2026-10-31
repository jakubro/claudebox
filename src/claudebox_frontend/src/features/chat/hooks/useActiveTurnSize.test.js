/** Tests for useActiveTurnSize - the live turn's size, margin included, kept current. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRowSizeStore } from '../utils/rowSizeStore'
import useActiveTurnSize from './useActiveTurnSize'

let observers = []

function messagesWithTurn(turnId, height) {
  const messages = document.createElement('div')
  const turn = document.createElement('div')
  turn.className = 'turn-container'
  turn.dataset.turnId = turnId
  turn.style.marginBottom = '16px'
  turn.getBoundingClientRect = () => ({ height })
  messages.appendChild(turn)
  document.body.appendChild(messages)

  return { messagesRef: { current: messages }, turn }
}

describe('useActiveTurnSize', () => {
  beforeEach(() => {
    observers = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          this.callback = callback
          this.disconnect = vi.fn()
          observers.push(this)
        }
        observe() {}
      },
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('publishes the turn height plus its bottom margin', () => {
    const rowSizes = createRowSizeStore()
    const { messagesRef } = messagesWithTurn('live', 300)

    renderHook(() => useActiveTurnSize(messagesRef, 'live', 0, rowSizes))

    expect(rowSizes.get('live')).toBe(316)
  })

  it('republishes as the turn grows', () => {
    const rowSizes = createRowSizeStore()
    const { messagesRef, turn } = messagesWithTurn('live', 300)
    renderHook(() => useActiveTurnSize(messagesRef, 'live', 0, rowSizes))

    turn.getBoundingClientRect = () => ({ height: 500 })
    observers[0].callback()

    expect(rowSizes.get('live')).toBe(516)
  })

  it('stops observing when the active turn changes', () => {
    const rowSizes = createRowSizeStore()
    const { messagesRef } = messagesWithTurn('first', 300)
    const { rerender } = renderHook(({ id }) => useActiveTurnSize(messagesRef, id, 0, rowSizes), {
      initialProps: { id: 'first' },
    })

    rerender({ id: 'second' })

    expect(observers[0].disconnect).toHaveBeenCalled()
  })

  it('re-attaches when the live turn remounts under the same id', () => {
    const rowSizes = createRowSizeStore()
    const { messagesRef, turn } = messagesWithTurn('live', 300)
    const { rerender } = renderHook(
      ({ index }) => useActiveTurnSize(messagesRef, 'live', index, rowSizes),
      { initialProps: { index: 4 } },
    )
    turn.getBoundingClientRect = () => ({ height: 420 })

    rerender({ index: 3 })

    expect(observers[0].disconnect).toHaveBeenCalled()
    expect(rowSizes.get('live')).toBe(436)
  })

  it('ignores a turn that has not painted yet', () => {
    const rowSizes = createRowSizeStore()
    const { messagesRef } = messagesWithTurn('live', 0)

    renderHook(() => useActiveTurnSize(messagesRef, 'live', 0, rowSizes))

    expect(rowSizes.get('live')).toBeUndefined()
  })
})
