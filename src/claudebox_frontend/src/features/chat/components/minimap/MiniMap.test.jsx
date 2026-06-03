/** Tests for MiniMap. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MiniMap from './MiniMap'

// Stable reference to prevent infinite re-render from turnHeights={} default
const EMPTY_HEIGHTS = {}

describe('MiniMap', () => {
  beforeEach(() => {
    // Stub ResizeObserver as a proper class (global mock is arrow fn, can't be used with `new`)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb) {
          this._cb = cb
          this.observe = vi.fn()
          this.unobserve = vi.fn()
          this.disconnect = vi.fn()
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const createMockRef = () => ({
    current: {
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTop: 0,
      offsetHeight: 500,
      getBoundingClientRect: () => ({
        top: 0,
        right: 500,
        bottom: 500,
        left: 0,
        height: 500,
        width: 500,
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })

  it('renders nothing when no groups', () => {
    render(
      <MiniMap
        groups={[]}
        turnResults={{}}
        messagesRef={createMockRef()}
        turnHeights={EMPTY_HEIGHTS}
      />,
    )
    expect(screen.queryByTestId('minimap')).not.toBeInTheDocument()
  })

  describe('segments and sub-bars', () => {
    it('renders one segment when no compactions', () => {
      const groups = [
        { turn_id: '1', userMessage: 'Hello', events: [] },
        { turn_id: '2', userMessage: 'World', events: [{ type: 'assistant' }] },
      ]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      expect(screen.getAllByTestId('minimap-segment')).toHaveLength(1)
    })

    it('renders one sub-bar per turn', () => {
      const groups = [
        { turn_id: '1', userMessage: 'Hello', events: [] },
        { turn_id: '2', userMessage: 'World', events: [{ type: 'assistant' }] },
      ]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      expect(screen.getAllByTestId('minimap-subbar')).toHaveLength(2)
    })

    it('renders pending sub-bars', () => {
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
          pendingCount={2}
        />,
      )

      expect(screen.getAllByTestId('minimap-subbar-pending')).toHaveLength(2)
    })

    it('creates new segment at compaction boundary', () => {
      const groups = [
        { turn_id: '1', userMessage: 'Before', events: [] },
        { turn_id: '2', userMessage: 'After', events: [{ subtype: 'compact_boundary' }] },
        { turn_id: '3', userMessage: 'Later', events: [] },
      ]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      expect(screen.getAllByTestId('minimap-segment')).toHaveLength(2)
    })

    it('marks error turns with error class', () => {
      const groups = [{ turn_id: 'err-turn', userMessage: 'Fail', events: [] }]
      render(
        <MiniMap
          groups={groups}
          turnResults={{ 'err-turn': 'error' }}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      expect(screen.getByTestId('minimap-subbar')).toHaveClass('error')
    })

    it('renders viewport thumb', () => {
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      expect(screen.getByTestId('minimap-viewport')).toBeInTheDocument()
    })

    it('starts hidden (not visible)', () => {
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      expect(screen.getByTestId('minimap')).not.toHaveClass('visible')
    })

    it('renders human lines for turns with user messages', () => {
      const groups = [
        { turn_id: '1', userMessage: 'Hello', events: [] },
        { turn_id: '2', userMessage: null, events: [{ type: 'assistant' }] },
        { turn_id: '3', userMessage: 'World', events: [] },
      ]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      expect(screen.getAllByTestId('minimap-human-line')).toHaveLength(2)
    })

    it('uses proportional heights from turnHeights prop', () => {
      const groups = [
        { turn_id: '1', userMessage: 'Short', events: [] },
        { turn_id: '2', userMessage: 'Tall', events: [] },
      ]
      const turnHeights = { 0: 100, 1: 300 }
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={turnHeights}
        />,
      )

      const subbars = screen.getAllByTestId('minimap-subbar')
      expect(subbars[0]).toHaveStyle({ flex: '100' })
      expect(subbars[1]).toHaveStyle({ flex: '300' })
    })

    it('sets proportional human-line height from userMessageHeights', () => {
      const groups = [
        { turn_id: '1', userMessage: 'Short msg', events: [] },
        { turn_id: '2', userMessage: 'Long stack trace', events: [] },
        { turn_id: '3', userMessage: null, events: [{ type: 'assistant' }] },
      ]
      const turnHeights = { 0: 200, 1: 500, 2: 300 }
      // Turn 0: user msg is 40px of 200px total (20%)
      // Turn 1: user msg is 400px of 500px total (80%)
      // Turn 2: no user message
      const userMessageHeights = { 0: 40, 1: 400, 2: 0 }
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={turnHeights}
          userMessageHeights={userMessageHeights}
        />,
      )

      const humanLines = screen.getAllByTestId('minimap-human-line')
      expect(humanLines).toHaveLength(2)
      expect(humanLines[0]).toHaveStyle({ height: '20%' })
      expect(humanLines[1]).toHaveStyle({ height: '80%' })
    })

    it('renders human-line without inline height when userMessageHeights not provided', () => {
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      const humanLine = screen.getByTestId('minimap-human-line')
      // No inline height — CSS min-height handles it
      expect(humanLine.style.height).toBe('')
    })
  })

  describe('streaming mode', () => {
    it('becomes visible when isStreaming is true (even without persistent)', () => {
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
          isStreaming={true}
        />,
      )

      expect(screen.getByTestId('minimap')).toHaveClass('visible')
    })

    it('hides after streaming ends (when not persistent)', () => {
      vi.useFakeTimers()
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      const { rerender } = render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
          isStreaming={true}
        />,
      )

      expect(screen.getByTestId('minimap')).toHaveClass('visible')

      rerender(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
          isStreaming={false}
        />,
      )

      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(screen.getByTestId('minimap')).not.toHaveClass('visible')
      vi.useRealTimers()
    })
  })

  describe('deferred viewport update', () => {
    it('defers updateViewport via requestAnimationFrame on groups change', () => {
      const rAFSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(_cb => {
        // Don't call _cb immediately — verify deferral
        return 42
      })

      const messagesRef = createMockRef()
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]

      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={messagesRef}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      // rAF should have been called (from the effect)
      expect(rAFSpy).toHaveBeenCalled()

      rAFSpy.mockRestore()
    })
  })

  describe('click-to-jump', () => {
    it('calls scrollTo on the messages container when minimap is clicked', () => {
      const scrollTo = vi.fn()
      const messagesRef = {
        current: {
          scrollHeight: 2000,
          clientHeight: 500,
          scrollTop: 0,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          getBoundingClientRect: () => ({
            top: 0,
            right: 500,
            bottom: 500,
            left: 0,
            height: 500,
            width: 500,
          }),
          scrollTo,
        },
      }
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]

      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={messagesRef}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      const minimap = screen.getByTestId('minimap')
      // Simulate getBoundingClientRect on the minimap element itself
      minimap.getBoundingClientRect = () => ({
        top: 0,
        height: 400,
        left: 0,
        right: 20,
        bottom: 400,
        width: 20,
      })

      minimap.click()

      expect(scrollTo).toHaveBeenCalled()
    })
  })

  describe('drag scrolling', () => {
    it('sets scrollTop on mousedown (drag start)', () => {
      const messagesRef = {
        current: {
          scrollHeight: 2000,
          clientHeight: 500,
          scrollTop: 0,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          getBoundingClientRect: () => ({
            top: 0,
            right: 500,
            bottom: 500,
            left: 0,
            height: 500,
            width: 500,
          }),
          scrollTo: vi.fn(),
        },
      }
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]

      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={messagesRef}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      const minimap = screen.getByTestId('minimap')
      minimap.getBoundingClientRect = () => ({
        top: 0,
        height: 400,
        left: 0,
        right: 20,
        bottom: 400,
        width: 20,
      })

      // fireEvent triggers React's onPointerDown handler which calls handleDrag
      fireEvent.pointerDown(minimap, { clientY: 200 })

      // handleDrag sets container.scrollTop directly based on ratio
      expect(messagesRef.current.scrollTop).not.toBe(0)
    })
  })

  describe('proximity show/hide', () => {
    it('becomes visible when mouse is near right edge of container', () => {
      const addEventListenerCalls = {}
      const messagesRef = {
        current: {
          scrollHeight: 2000,
          clientHeight: 500,
          scrollTop: 0,
          addEventListener: vi.fn((event, handler) => {
            if (!addEventListenerCalls[event]) {
              addEventListenerCalls[event] = []
            }
            addEventListenerCalls[event].push(handler)
          }),
          removeEventListener: vi.fn(),
          getBoundingClientRect: () => ({
            top: 0,
            right: 500,
            bottom: 500,
            left: 0,
            height: 500,
            width: 500,
          }),
          scrollTo: vi.fn(),
        },
      }
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]

      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={messagesRef}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      const minimap = screen.getByTestId('minimap')

      // Initially not visible
      expect(minimap).not.toHaveClass('visible')

      // Simulate pointer near right edge (within 50px of right boundary at 500)
      const pointerMoveHandler = addEventListenerCalls.pointermove?.[0]
      expect(pointerMoveHandler).toBeDefined()

      // Wrap in act() — showMinimap calls setVisible (state update)
      act(() => {
        pointerMoveHandler({ clientX: 470 }) // 30px from right edge (< 50)
      })

      // Should now have visible class
      expect(minimap).toHaveClass('visible')
    })

    it('hides after timeout', () => {
      vi.useFakeTimers()
      const addEventListenerCalls = {}
      const messagesRef = {
        current: {
          scrollHeight: 2000,
          clientHeight: 500,
          scrollTop: 0,
          addEventListener: vi.fn((event, handler) => {
            if (!addEventListenerCalls[event]) {
              addEventListenerCalls[event] = []
            }
            addEventListenerCalls[event].push(handler)
          }),
          removeEventListener: vi.fn(),
          getBoundingClientRect: () => ({
            top: 0,
            right: 500,
            bottom: 500,
            left: 0,
            height: 500,
            width: 500,
          }),
          scrollTo: vi.fn(),
        },
      }
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]

      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={messagesRef}
          turnHeights={EMPTY_HEIGHTS}
        />,
      )

      const minimap = screen.getByTestId('minimap')

      // Show via proximity — wrap in act() for state update
      const pointerMoveHandler = addEventListenerCalls.pointermove?.[0]
      act(() => {
        pointerMoveHandler({ clientX: 470 })
      })
      expect(minimap).toHaveClass('visible')

      // After 750ms timeout, should hide
      act(() => {
        vi.advanceTimersByTime(800)
      })
      expect(minimap).not.toHaveClass('visible')

      vi.useRealTimers()
    })
  })

  describe('persistent mode', () => {
    it('is always visible when persistent is true', () => {
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
          persistent={true}
        />,
      )

      expect(screen.getByTestId('minimap')).toHaveClass('visible')
    })

    it('does not hide after timeout when persistent', () => {
      vi.useFakeTimers()
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
          persistent={true}
        />,
      )

      const minimap = screen.getByTestId('minimap')
      expect(minimap).toHaveClass('visible')

      // Fire pointer leave — should not trigger hide timer
      fireEvent.pointerLeave(minimap)
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(minimap).toHaveClass('visible')
      vi.useRealTimers()
    })

    it('hides when persistent changes from true to false', () => {
      const groups = [{ turn_id: '1', userMessage: 'Hello', events: [] }]
      const { rerender } = render(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
          persistent={true}
        />,
      )

      expect(screen.getByTestId('minimap')).toHaveClass('visible')

      rerender(
        <MiniMap
          groups={groups}
          turnResults={{}}
          messagesRef={createMockRef()}
          turnHeights={EMPTY_HEIGHTS}
          persistent={false}
        />,
      )

      expect(screen.getByTestId('minimap')).not.toHaveClass('visible')
    })
  })
})
