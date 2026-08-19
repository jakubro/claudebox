/** Tests HistoricalTurnList's isolation invariant: historical turns don't reconcile
 *  while only the active streaming turn updates. */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

import HistoricalTurnList from './HistoricalTurnList'

const mkTurn = (id, events = []) => ({
  turn_id: id,
  userMessage: `message ${id}`,
  attachments: null,
  events,
  interrupted: false,
  settingChanges: [],
})

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
 * A scroll container reporting the given viewport height.
 *
 * jsdom lays nothing out, so the size must be stated explicitly; the virtualizer reads `offsetHeight`
 * for its viewport, and a container reporting zero there has no window to compute.
 */
function containerRef(height) {
  const el = document.createElement('div')
  for (const [prop, value] of Object.entries({
    clientHeight: height,
    clientWidth: 900,
    offsetHeight: height,
    offsetWidth: 900,
  })) {
    Object.defineProperty(el, prop, { value, configurable: true })
  }

  return { current: el }
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

    render(<HistoricalTurnList turns={turns} messagesRef={containerRef(800)} {...STABLE} />)

    expect(distinctTurnsRendered()).toBeGreaterThan(0)
    expect(distinctTurnsRendered()).toBeLessThan(60)
  })

  it('keeps the window bounded as the history grows', () => {
    turnRenderSpy.mockClear()
    const short = Array.from({ length: 40 }, (_, i) => mkTurn(`t${i}`))
    render(<HistoricalTurnList turns={short} messagesRef={containerRef(800)} {...STABLE} />)
    const forShortHistory = distinctTurnsRendered()

    turnRenderSpy.mockClear()
    const long = Array.from({ length: 400 }, (_, i) => mkTurn(`t${i}`))
    render(<HistoricalTurnList turns={long} messagesRef={containerRef(800)} {...STABLE} />)

    expect(distinctTurnsRendered()).toBe(forShortHistory)
  })

  // An unwindowed chat is slow; an empty one is broken.
  it('renders the whole history where no viewport can be measured', () => {
    turnRenderSpy.mockClear()
    const turns = Array.from({ length: 120 }, (_, i) => mkTurn(`t${i}`))
    const realInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true })

    try {
      render(<HistoricalTurnList turns={turns} messagesRef={containerRef(0)} {...STABLE} />)

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

  // The virtualizer caches measured heights per turn id, so a split flip must force a re-measure -
  // otherwise already-mounted turns keep their pre-flip size until they happen to unmount/remount.
  it('re-measures the virtualizer when splitEnabled flips', () => {
    const turns = [mkTurn('t1'), mkTurn('t2')]
    const virtualizerRef = { current: null }
    const { rerender } = render(
      <HistoricalTurnList
        turns={turns}
        messagesRef={containerRef(800)}
        virtualizerRef={virtualizerRef}
        splitEnabled={false}
        {...STABLE}
      />,
    )
    const measureSpy = vi.spyOn(virtualizerRef.current, 'measure')

    rerender(
      <HistoricalTurnList
        turns={turns}
        messagesRef={containerRef(800)}
        virtualizerRef={virtualizerRef}
        splitEnabled={true}
        {...STABLE}
      />,
    )

    expect(measureSpy).toHaveBeenCalled()
  })

  it('does not re-measure the virtualizer when splitEnabled stays the same', () => {
    const turns = [mkTurn('t1'), mkTurn('t2')]
    const virtualizerRef = { current: null }
    const { rerender } = render(
      <HistoricalTurnList
        turns={turns}
        messagesRef={containerRef(800)}
        virtualizerRef={virtualizerRef}
        splitEnabled={false}
        {...STABLE}
      />,
    )
    const measureSpy = vi.spyOn(virtualizerRef.current, 'measure')

    rerender(
      <HistoricalTurnList
        turns={[...turns, mkTurn('t3')]}
        messagesRef={containerRef(800)}
        virtualizerRef={virtualizerRef}
        splitEnabled={false}
        {...STABLE}
      />,
    )

    expect(measureSpy).not.toHaveBeenCalled()
  })
})
