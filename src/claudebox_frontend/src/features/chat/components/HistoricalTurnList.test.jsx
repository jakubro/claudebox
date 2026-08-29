/** Tests HistoricalTurnList's isolation invariant: historical turns don't reconcile
 *  while only the active streaming turn updates. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorBoundary from '../../../components/ErrorBoundary.jsx'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import { TurnRoutingContext } from './turn/TurnRoutingContext'

vi.mock('../../../utils/errorReporting', () => ({ reportRenderError: vi.fn() }))

// Render spy: count how many times a Turn is (re)rendered by the list.
const turnRenderSpy = vi.fn()
vi.mock('./turn', () => ({
  default: props => {
    turnRenderSpy(props.turnId)
    return <div data-testid="turn" data-turn-id={props.turnId} />
  },
}))
vi.mock('./SettingChangeDivider', () => ({
  default: () => <div data-testid="setting-change" />,
}))
// Stubbed here - ThreadFoldRow's own label/source resolution is covered by its own test file;
// this file only cares whether HistoricalTurnList mounts it, and can toggle it.
vi.mock('./ThreadFoldRow', () => ({
  default: ({ turnCount, expanded, onToggle }) => (
    <button
      type="button"
      data-testid="thread-fold-row"
      data-turn-count={turnCount}
      onClick={onToggle}>
      {expanded ? 'expanded' : 'collapsed'}
    </button>
  ),
}))

import HistoricalTurnList from './HistoricalTurnList'

const mkTurn = (id, events = [], settingChanges = []) => ({
  turn_id: id,
  userMessage: `message ${id}`,
  attachments: null,
  events,
  interrupted: false,
  settingChanges,
})

const mkForkDividerTurn = (id, forkParentId) =>
  mkTurn(
    id,
    [],
    [
      {
        type: 'system',
        subtype: 'container_restarted',
        message_data: { fork_parent_session_id: forkParentId },
      },
    ],
  )

// Referentially-stable shared props: only `turns` varies between rerenders, mirroring ChatPanel
// where callbacks/maps are stable and only the turn list identity changes per flush.
const noop = () => {}
const STABLE = {
  boundaryNextUserMessage: 'active turn message',
  todoDiffs: new Map(),
  taskNotifications: new Map(),
  turnResults: {},
  duplicateAskUserIds: new Set(),
  hasPendingMessages: false,
  forkingTurnId: null,
  onFormSubmit: noop,
  onRewind: noop,
  isBookmarked: () => false,
  onToggleBookmark: noop,
}

/**
 * A scroll container element reporting the given viewport height.
 *
 * jsdom lays nothing out, so the size must be stated explicitly; the virtualizer reads `offsetHeight`
 * for its viewport, and a container reporting zero there has no window to compute.
 */
function sizedElement(height) {
  const el = document.createElement('div')
  for (const [prop, value] of Object.entries({
    clientHeight: height,
    clientWidth: 900,
    offsetHeight: height,
    offsetWidth: 900,
  })) {
    Object.defineProperty(el, prop, { value, configurable: true })
  }

  return el
}

const distinctTurnsRendered = () => new Set(turnRenderSpy.mock.calls.map(c => c[0])).size

describe('HistoricalTurnList', () => {
  it('renders every historical turn on first paint', () => {
    turnRenderSpy.mockClear()
    const turns = [mkTurn('t1'), mkTurn('t2')]
    render(<HistoricalTurnList turns={turns} {...STABLE} />)
    expect(turnRenderSpy).toHaveBeenCalledTimes(2)
  })

  // The whole point of the windowed list: cost stops tracking history length.
  it('mounts a bounded window rather than the whole history', () => {
    turnRenderSpy.mockClear()
    const turns = Array.from({ length: 400 }, (_, i) => mkTurn(`t${i}`))

    render(<HistoricalTurnList turns={turns} messagesEl={sizedElement(800)} {...STABLE} />)

    expect(distinctTurnsRendered()).toBeGreaterThan(0)
    expect(distinctTurnsRendered()).toBeLessThan(60)
  })

  it('keeps the window bounded as the history grows', () => {
    turnRenderSpy.mockClear()
    const short = Array.from({ length: 40 }, (_, i) => mkTurn(`t${i}`))
    render(<HistoricalTurnList turns={short} messagesEl={sizedElement(800)} {...STABLE} />)
    const forShortHistory = distinctTurnsRendered()

    turnRenderSpy.mockClear()
    const long = Array.from({ length: 400 }, (_, i) => mkTurn(`t${i}`))
    render(<HistoricalTurnList turns={long} messagesEl={sizedElement(800)} {...STABLE} />)

    expect(distinctTurnsRendered()).toBe(forShortHistory)
  })

  // An unwindowed chat is slow; an empty one is broken.
  it('renders the whole history where no viewport can be measured', () => {
    turnRenderSpy.mockClear()
    const turns = Array.from({ length: 120 }, (_, i) => mkTurn(`t${i}`))
    const realInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true })

    try {
      render(<HistoricalTurnList turns={turns} messagesEl={sizedElement(0)} {...STABLE} />)

      expect(distinctTurnsRendered()).toBe(120)
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        value: realInnerHeight,
        configurable: true,
      })
    }
  })

  it('does NOT re-render historical turns when only the active turn updates (flush)', () => {
    const t1 = mkTurn('t1')
    const t2 = mkTurn('t2')
    const { rerender } = render(<HistoricalTurnList turns={[t1, t2]} {...STABLE} />)
    turnRenderSpy.mockClear()

    // A streaming flush: ChatPanel re-renders and hands down a NEW array that still holds the
    // SAME historical turn refs (the active turn lives outside this list); the memo must bail.
    rerender(<HistoricalTurnList turns={[t1, t2]} {...STABLE} />)
    expect(turnRenderSpy).not.toHaveBeenCalled()
  })

  it('re-renders when a turn completes and joins history (lifecycle transition)', () => {
    const t1 = mkTurn('t1')
    const t2 = mkTurn('t2')
    const t3 = mkTurn('t3')
    const { rerender } = render(<HistoricalTurnList turns={[t1, t2]} {...STABLE} />)
    turnRenderSpy.mockClear()

    rerender(<HistoricalTurnList turns={[t1, t2, t3]} {...STABLE} />)
    expect(turnRenderSpy).toHaveBeenCalled()
  })

  it('passes the active turn user message as the last historical turn next-message', () => {
    turnRenderSpy.mockClear()
    const turns = [mkTurn('t1'), mkTurn('t2')]
    render(<HistoricalTurnList turns={turns} {...STABLE} />)
    // Spy is called with turnId only; this also exercises boundary handling for the final turn (no throw).
    expect(turnRenderSpy).toHaveBeenCalledWith('t1')
    expect(turnRenderSpy).toHaveBeenCalledWith('t2')
  })

  // The virtualizer caches measured heights per turn id, so a routing-mode flip must force a
  // re-measure - otherwise mounted turns keep their pre-flip size until they remount.
  it('re-measures the virtualizer when the routing mode flips', () => {
    const turns = [mkTurn('t1'), mkTurn('t2')]
    const virtualizerRef = { current: null }
    const { rerender } = render(
      <TurnRoutingContext.Provider value={TurnRoutingMode.OFF}>
        <HistoricalTurnList
          turns={turns}
          messagesEl={sizedElement(800)}
          virtualizerRef={virtualizerRef}
          {...STABLE}
        />
      </TurnRoutingContext.Provider>,
    )
    const measureSpy = vi.spyOn(virtualizerRef.current, 'measure')

    rerender(
      <TurnRoutingContext.Provider value={TurnRoutingMode.BASH_ONLY}>
        <HistoricalTurnList
          turns={turns}
          messagesEl={sizedElement(800)}
          virtualizerRef={virtualizerRef}
          {...STABLE}
        />
      </TurnRoutingContext.Provider>,
    )

    expect(measureSpy).toHaveBeenCalled()
  })

  it('does not re-measure the virtualizer when the routing mode stays the same', () => {
    const turns = [mkTurn('t1'), mkTurn('t2')]
    const virtualizerRef = { current: null }
    const { rerender } = render(
      <TurnRoutingContext.Provider value={TurnRoutingMode.OFF}>
        <HistoricalTurnList
          turns={turns}
          messagesEl={sizedElement(800)}
          virtualizerRef={virtualizerRef}
          {...STABLE}
        />
      </TurnRoutingContext.Provider>,
    )
    const measureSpy = vi.spyOn(virtualizerRef.current, 'measure')

    rerender(
      <TurnRoutingContext.Provider value={TurnRoutingMode.OFF}>
        <HistoricalTurnList
          turns={[...turns, mkTurn('t3')]}
          messagesEl={sizedElement(800)}
          virtualizerRef={virtualizerRef}
          {...STABLE}
        />
      </TurnRoutingContext.Provider>,
    )

    expect(measureSpy).not.toHaveBeenCalled()
  })

  describe('promoted-thread fold', () => {
    it("folds the inherited turns behind one row, leaving the thread's own turns rendered", () => {
      turnRenderSpy.mockClear()
      const turns = [mkForkDividerTurn('t1', 'source-1'), mkTurn('t2'), mkTurn('t3')]

      render(<HistoricalTurnList turns={turns} isSideThread={true} {...STABLE} />)

      expect(screen.getByTestId('thread-fold-row')).toHaveAttribute('data-turn-count', '1')
      expect(turnRenderSpy).not.toHaveBeenCalledWith('t1')
      expect(turnRenderSpy).toHaveBeenCalledWith('t2')
      expect(turnRenderSpy).toHaveBeenCalledWith('t3')
    })

    it('folds nothing for an ordinary fork - no is_side_thread marker', () => {
      turnRenderSpy.mockClear()
      const turns = [mkForkDividerTurn('t1', 'source-1'), mkTurn('t2')]

      render(<HistoricalTurnList turns={turns} isSideThread={false} {...STABLE} />)

      expect(screen.queryByTestId('thread-fold-row')).not.toBeInTheDocument()
      expect(turnRenderSpy).toHaveBeenCalledWith('t1')
      expect(turnRenderSpy).toHaveBeenCalledWith('t2')
    })

    it('folds nothing when no turn carries a fork divider', () => {
      turnRenderSpy.mockClear()
      const turns = [mkTurn('t1'), mkTurn('t2')]

      render(<HistoricalTurnList turns={turns} isSideThread={true} {...STABLE} />)

      expect(screen.queryByTestId('thread-fold-row')).not.toBeInTheDocument()
      expect(turnRenderSpy).toHaveBeenCalledWith('t1')
      expect(turnRenderSpy).toHaveBeenCalledWith('t2')
    })

    it('folds a single-turn run - no minimum run', () => {
      const turns = [mkForkDividerTurn('t1', 'source-1'), mkTurn('t2')]

      render(<HistoricalTurnList turns={turns} isSideThread={true} {...STABLE} />)

      expect(screen.getByTestId('thread-fold-row')).toHaveAttribute('data-turn-count', '1')
    })

    it('clicking the fold row reveals the inherited turns in place (uncontrolled)', () => {
      turnRenderSpy.mockClear()
      const turns = [mkForkDividerTurn('t1', 'source-1'), mkTurn('t2')]

      render(<HistoricalTurnList turns={turns} isSideThread={true} {...STABLE} />)
      expect(turnRenderSpy).not.toHaveBeenCalledWith('t1')

      fireEvent.click(screen.getByTestId('thread-fold-row'))

      expect(screen.getByTestId('thread-fold-row')).toHaveTextContent('expanded')
      expect(turnRenderSpy).toHaveBeenCalledWith('t1')
      expect(turnRenderSpy).toHaveBeenCalledWith('t2')
    })

    it('starts folded on every fresh mount - per group, not shared across sessions', () => {
      const turns = [mkForkDividerTurn('t1', 'source-1'), mkTurn('t2')]
      const { unmount } = render(
        <HistoricalTurnList turns={turns} isSideThread={true} {...STABLE} />,
      )
      fireEvent.click(screen.getByTestId('thread-fold-row'))
      expect(screen.getByTestId('thread-fold-row')).toHaveTextContent('expanded')
      unmount()

      render(<HistoricalTurnList turns={turns} isSideThread={true} {...STABLE} />)
      expect(screen.getByTestId('thread-fold-row')).toHaveTextContent('collapsed')
    })

    it('honors a controlled expanded prop instead of managing its own state', () => {
      const turns = [mkForkDividerTurn('t1', 'source-1'), mkTurn('t2')]
      const onToggleExpanded = vi.fn()

      const { rerender } = render(
        <HistoricalTurnList
          turns={turns}
          isSideThread={true}
          expanded={false}
          onToggleExpanded={onToggleExpanded}
          {...STABLE}
        />,
      )
      fireEvent.click(screen.getByTestId('thread-fold-row'))

      // Uncontrolled would now read "expanded" - controlled defers entirely to the caller's own
      // state, which this test never updates.
      expect(onToggleExpanded).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('thread-fold-row')).toHaveTextContent('collapsed')

      rerender(
        <HistoricalTurnList
          turns={turns}
          isSideThread={true}
          expanded={true}
          onToggleExpanded={onToggleExpanded}
          {...STABLE}
        />,
      )
      expect(screen.getByTestId('thread-fold-row')).toHaveTextContent('expanded')
    })
  })

  // The stubbed Turn reports no real height, so the other tests never reach the virtualizer's
  // resizeItem -> notify -> rerender path. This one forces it at 350 non-uniform rows.
  describe('large session with real, diverging row measurements', () => {
    it('settles within a bounded window and never trips the error boundary', () => {
      const originalGetRect = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function stubbedRect() {
        if (!this.classList?.contains('historical-turn-row')) {
          return originalGetRect.call(this)
        }
        const index = Number(this.dataset.index)
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          x: 0,
          y: 0,
          width: 900,
          height: 90 + (index % 5) * 22,
          toJSON() {},
        }
      }

      try {
        turnRenderSpy.mockClear()
        const turns = Array.from({ length: 350 }, (_, i) => mkTurn(`t${i}`))

        render(
          <ErrorBoundary label="test">
            <HistoricalTurnList turns={turns} messagesEl={sizedElement(800)} {...STABLE} />
          </ErrorBoundary>,
        )

        expect(screen.queryByText('This panel stopped responding.')).not.toBeInTheDocument()
        expect(distinctTurnsRendered()).toBeGreaterThan(0)
        expect(distinctTurnsRendered()).toBeLessThan(60)
      } finally {
        Element.prototype.getBoundingClientRect = originalGetRect
      }
    })
  })
})
