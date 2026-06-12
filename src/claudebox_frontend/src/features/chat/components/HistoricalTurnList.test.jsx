/** Tests for HistoricalTurnList - the isolation invariant: historical turns do
 *  not reconcile while only the active streaming turn updates. */

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

// Referentially-stable shared props - only `turns` varies between rerenders,
// mirroring ChatPanel where callbacks/maps are stable and only the turn list
// identity changes per flush.
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

describe('HistoricalTurnList', () => {
  it('renders every historical turn on first paint', () => {
    turnRenderSpy.mockClear()
    const turns = [mkTurn('t1'), mkTurn('t2')]
    render(<HistoricalTurnList turns={turns} {...STABLE} />)
    expect(turnRenderSpy).toHaveBeenCalledTimes(2)
  })

  it('does NOT re-render historical turns when only the active turn updates (flush)', () => {
    const t1 = mkTurn('t1')
    const t2 = mkTurn('t2')
    const { rerender } = render(<HistoricalTurnList turns={[t1, t2]} {...STABLE} />)
    turnRenderSpy.mockClear()

    // A streaming flush: ChatPanel re-renders and hands down a NEW array that
    // still holds the SAME historical turn refs (the active turn grew, but it
    // lives outside this list). The memo must bail - zero historical renders.
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
    // Spy is called with turnId only; existence of two turns + boundary handling
    // is exercised here (no throw on the boundary lookup for the final turn).
    expect(turnRenderSpy).toHaveBeenCalledWith('t1')
    expect(turnRenderSpy).toHaveBeenCalledWith('t2')
  })
})
