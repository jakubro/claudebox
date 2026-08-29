/** Tests for ColumnMinimap. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ColumnMinimap from './ColumnMinimap'

function bar(id, overrides = {}) {
  return { id, height: 100, width: 8, status: 'passed', ...overrides }
}

const createMockRef = () => ({
  current: {
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTop: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ top: 0, right: 500, bottom: 500, left: 0 }),
    scrollTo: vi.fn(),
  },
})

describe('ColumnMinimap', () => {
  beforeEach(() => {
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

  it('renders nothing when there are no bars - no commands run yet', () => {
    render(<ColumnMinimap variant="terminal" bars={[]} containerRef={createMockRef()} />)
    expect(screen.queryByTestId('terminal-minimap')).not.toBeInTheDocument()
  })

  it('renders one bar per entry, in order', () => {
    render(
      <ColumnMinimap
        variant="terminal"
        bars={[bar('a'), bar('b'), bar('c')]}
        containerRef={createMockRef()}
      />,
    )
    expect(screen.getAllByTestId('terminal-minimap-bar')).toHaveLength(3)
  })

  it('sizes a bar from height (flex) and width, no segments or human lines', () => {
    render(
      <ColumnMinimap
        variant="terminal"
        bars={[bar('a', { height: 240, width: 14 })]}
        containerRef={createMockRef()}
      />,
    )
    const el = screen.getByTestId('terminal-minimap-bar')
    expect(el).toHaveStyle({ flex: '240', width: '14px' })
    expect(screen.queryByTestId('minimap-human-line')).not.toBeInTheDocument()
  })

  it('colours a bar by status - passed, failed, running are distinct classes', () => {
    render(
      <ColumnMinimap
        variant="terminal"
        bars={[
          bar('a', { status: 'passed' }),
          bar('b', { status: 'failed' }),
          bar('c', { status: 'running' }),
        ]}
        containerRef={createMockRef()}
      />,
    )
    const bars = screen.getAllByTestId('terminal-minimap-bar')
    expect(bars[0]).toHaveClass('terminal-minimap-bar-passed')
    expect(bars[1]).toHaveClass('terminal-minimap-bar-failed')
    expect(bars[2]).toHaveClass('terminal-minimap-bar-running')
  })

  it('renders the viewport thumb', () => {
    render(<ColumnMinimap variant="terminal" bars={[bar('a')]} containerRef={createMockRef()} />)
    expect(screen.getByTestId('terminal-minimap-viewport')).toBeInTheDocument()
  })

  it('starts hidden (not visible)', () => {
    render(<ColumnMinimap variant="terminal" bars={[bar('a')]} containerRef={createMockRef()} />)
    expect(screen.getByTestId('terminal-minimap')).not.toHaveClass('visible')
  })

  describe('click-to-jump', () => {
    it('calls scrollTo on the terminal container when clicked', () => {
      const containerRef = createMockRef()
      containerRef.current.getBoundingClientRect = () => ({
        top: 0,
        right: 500,
        bottom: 500,
        left: 0,
      })
      render(<ColumnMinimap variant="terminal" bars={[bar('a')]} containerRef={containerRef} />)

      const map = screen.getByTestId('terminal-minimap')
      map.getBoundingClientRect = () => ({ top: 0, height: 400, left: 0, right: 20, bottom: 400 })
      map.click()

      expect(containerRef.current.scrollTo).toHaveBeenCalled()
    })
  })

  describe('drag scrolling', () => {
    it('sets scrollTop on pointerdown (drag start)', () => {
      const containerRef = createMockRef()
      render(<ColumnMinimap variant="terminal" bars={[bar('a')]} containerRef={containerRef} />)

      const map = screen.getByTestId('terminal-minimap')
      map.getBoundingClientRect = () => ({ top: 0, height: 400, left: 0, right: 20, bottom: 400 })
      fireEvent.pointerDown(map, { clientY: 200 })

      expect(containerRef.current.scrollTop).not.toBe(0)
    })
  })

  describe('landing transition', () => {
    it('reports landed-at-bottom to the caller after a bottom click', () => {
      const onScrollLanding = vi.fn()
      const containerRef = createMockRef()
      render(
        <ColumnMinimap
          variant="terminal"
          bars={[bar('a')]}
          containerRef={containerRef}
          onScrollLanding={onScrollLanding}
        />,
      )

      const map = screen.getByTestId('terminal-minimap')
      map.getBoundingClientRect = () => ({ top: 0, height: 400, left: 0, right: 20, bottom: 400 })
      fireEvent.click(map, { clientY: 400 }) // ratio 1 -> bottom

      expect(onScrollLanding).toHaveBeenCalledWith(true)
    })

    it('does not throw when no landing callback is supplied', () => {
      const containerRef = createMockRef()
      render(<ColumnMinimap variant="terminal" bars={[bar('a')]} containerRef={containerRef} />)

      const map = screen.getByTestId('terminal-minimap')
      map.getBoundingClientRect = () => ({ top: 0, height: 400, left: 0, right: 20, bottom: 400 })
      expect(() => map.click()).not.toThrow()
    })
  })

  describe('persistent mode', () => {
    it('is always visible when persistent is true', () => {
      render(
        <ColumnMinimap
          variant="terminal"
          bars={[bar('a')]}
          containerRef={createMockRef()}
          persistent={true}
        />,
      )
      expect(screen.getByTestId('terminal-minimap')).toHaveClass('visible')
    })

    it('hides when persistent changes from true to false', () => {
      const { rerender } = render(
        <ColumnMinimap
          variant="terminal"
          bars={[bar('a')]}
          containerRef={createMockRef()}
          persistent={true}
        />,
      )
      expect(screen.getByTestId('terminal-minimap')).toHaveClass('visible')

      rerender(
        <ColumnMinimap
          variant="terminal"
          bars={[bar('a')]}
          containerRef={createMockRef()}
          persistent={false}
        />,
      )
      expect(screen.getByTestId('terminal-minimap')).not.toHaveClass('visible')
    })
  })

  describe('proximity show/hide', () => {
    it('becomes visible when the pointer nears the right edge', () => {
      const addEventListenerCalls = {}
      const containerRef = {
        current: {
          scrollHeight: 2000,
          clientHeight: 500,
          scrollTop: 0,
          addEventListener: vi.fn((event, handler) => {
            addEventListenerCalls[event] ||= []
            addEventListenerCalls[event].push(handler)
          }),
          removeEventListener: vi.fn(),
          getBoundingClientRect: () => ({ top: 0, right: 500, bottom: 500, left: 0 }),
          scrollTo: vi.fn(),
        },
      }
      render(<ColumnMinimap variant="terminal" bars={[bar('a')]} containerRef={containerRef} />)

      const map = screen.getByTestId('terminal-minimap')
      expect(map).not.toHaveClass('visible')

      const pointerMoveHandler = addEventListenerCalls.pointermove?.[0]
      act(() => {
        pointerMoveHandler({ clientX: 470 }) // 30px from the right edge at 500
      })

      expect(map).toHaveClass('visible')
    })
  })

  describe('variant', () => {
    it('renders under the work-minimap testid/class family when variant is work', () => {
      render(<ColumnMinimap variant="work" bars={[bar('a')]} containerRef={createMockRef()} />)

      expect(screen.getByTestId('work-minimap')).toBeInTheDocument()
      expect(screen.getByTestId('work-minimap-bar')).toBeInTheDocument()
      expect(screen.getByTestId('work-minimap-viewport')).toBeInTheDocument()
      expect(screen.queryByTestId('terminal-minimap')).not.toBeInTheDocument()
    })

    it('carries the variant into the bar status class, so work and terminal never share a selector', () => {
      render(
        <ColumnMinimap
          variant="work"
          bars={[bar('a', { status: 'failed' })]}
          containerRef={createMockRef()}
        />,
      )
      const el = screen.getByTestId('work-minimap-bar')
      expect(el).toHaveClass('work-minimap-bar-failed')
      expect(el).not.toHaveClass('terminal-minimap-bar-failed')
    })
  })
})
