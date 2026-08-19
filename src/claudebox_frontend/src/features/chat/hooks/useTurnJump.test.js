/** Tests for useTurnJump - scroll-and-highlight for replay-jump and terminal clicks. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockWithMountedTurn = vi.fn()
let mockScrollAndHighlight = vi.fn()

vi.mock('../../../utils/mountTurn', () => ({
  withMountedTurn: (...args) => mockWithMountedTurn(...args),
}))

vi.mock('../../../utils/scroll', () => ({
  scrollAndHighlight: (...args) => mockScrollAndHighlight(...args),
}))

import { useTurnJump } from './useTurnJump'

/** Turn element stub whose querySelector resolves user and assistant messages. */
function fakeTurnEl() {
  const userEl = { testid: 'message-user' }
  const assistantEl = { testid: 'message-assistant' }
  return {
    querySelector: sel => {
      if (sel.includes('message-user')) {
        return userEl
      }
      if (sel.includes('message-assistant')) {
        return assistantEl
      }
      return null
    },
    userEl,
    assistantEl,
  }
}

function baseParams(overrides = {}) {
  return {
    turnsRef: { current: [{ turn_id: 't-1' }] },
    turnVirtualizerRef: { current: {} },
    messagesRef: { current: { scrollTop: 0 } },
    chatAutoScrollEnabledRef: { current: true },
    isReplaying: false,
    activeTurnId: null,
    activeMessageType: null,
    ...overrides,
  }
}

describe('useTurnJump', () => {
  beforeEach(() => {
    mockWithMountedTurn = vi.fn()
    mockScrollAndHighlight = vi.fn()
  })

  describe('handleTerminalEntryClick', () => {
    it('mounts and scrolls to the assistant message for an entry with a turnId', () => {
      const el = fakeTurnEl()
      mockWithMountedTurn.mockImplementation(({ onResolved }) => onResolved(el))
      const params = baseParams()
      const { result } = renderHook(() => useTurnJump(params))

      result.current.handleTerminalEntryClick({ turnId: 't-1' })

      expect(mockWithMountedTurn).toHaveBeenCalledWith(
        expect.objectContaining({ turnId: 't-1', virtualizer: params.turnVirtualizerRef.current }),
      )
      expect(mockScrollAndHighlight).toHaveBeenCalledWith(
        params.messagesRef.current,
        el.assistantEl,
      )
      expect(params.chatAutoScrollEnabledRef.current).toBe(false)
    })

    it('does nothing for an orphan entry (no turnId)', () => {
      const { result } = renderHook(() => useTurnJump(baseParams()))

      result.current.handleTerminalEntryClick({ turnId: null })

      expect(mockWithMountedTurn).not.toHaveBeenCalled()
    })

    it('does nothing when the turn never resolves (windowed out, virtualizer gave up)', () => {
      mockWithMountedTurn.mockImplementation(({ onResolved }) => onResolved(null))
      const { result } = renderHook(() => useTurnJump(baseParams()))

      result.current.handleTerminalEntryClick({ turnId: 't-1' })

      expect(mockScrollAndHighlight).not.toHaveBeenCalled()
    })
  })

  describe('cross-session replay jump', () => {
    it('jumps to the assistant message once replay ends with a URL-carried activeTurnId', () => {
      const el = fakeTurnEl()
      mockWithMountedTurn.mockImplementation(({ onResolved }) => onResolved(el))

      const { rerender } = renderHook(props => useTurnJump(props), {
        initialProps: baseParams({ isReplaying: true, activeTurnId: 't-1' }),
      })
      expect(mockWithMountedTurn).not.toHaveBeenCalled()

      rerender(baseParams({ isReplaying: false, activeTurnId: 't-1', activeMessageType: null }))

      expect(mockScrollAndHighlight).toHaveBeenCalledWith(expect.anything(), el.assistantEl)
    })

    it('prefers the user message when activeMessageType is user', () => {
      const el = fakeTurnEl()
      mockWithMountedTurn.mockImplementation(({ onResolved }) => onResolved(el))

      const { rerender } = renderHook(props => useTurnJump(props), {
        initialProps: baseParams({ isReplaying: true, activeTurnId: 't-1' }),
      })
      rerender(baseParams({ isReplaying: false, activeTurnId: 't-1', activeMessageType: 'user' }))

      expect(mockScrollAndHighlight).toHaveBeenCalledWith(expect.anything(), el.userEl)
    })

    it('does not jump when replay ends with no activeTurnId', () => {
      const { rerender } = renderHook(props => useTurnJump(props), {
        initialProps: baseParams({ isReplaying: true, activeTurnId: null }),
      })
      rerender(baseParams({ isReplaying: false, activeTurnId: null }))

      expect(mockWithMountedTurn).not.toHaveBeenCalled()
    })

    it('does not jump on first mount without having observed a replay', () => {
      renderHook(props => useTurnJump(props), {
        initialProps: baseParams({ isReplaying: false, activeTurnId: 't-1' }),
      })

      expect(mockWithMountedTurn).not.toHaveBeenCalled()
    })
  })
})
