/** Tests for the right-slot view registry. */

import { describe, expect, it } from 'vitest'
import { CHAT_TERMINAL_MIN_WIDTH, CHAT_WORK_MIN_WIDTH } from '../../../config/dimensions'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import {
  RIGHT_SLOT_VIEWS,
  RightSlotView,
  resolveRightSlotRoutingMode,
  resolveStoredRightSlotView,
} from './rightSlotViews'

describe('RIGHT_SLOT_VIEWS', () => {
  it('has exactly the terminal and work views registered', () => {
    expect(Object.keys(RIGHT_SLOT_VIEWS)).toEqual([RightSlotView.TERMINAL, RightSlotView.WORK])
  })

  it("the terminal view's minWidth defaults to CHAT_TERMINAL_MIN_WIDTH", () => {
    expect(RIGHT_SLOT_VIEWS[RightSlotView.TERMINAL].minWidth).toBe(CHAT_TERMINAL_MIN_WIDTH)
  })

  it('the terminal view implies routing mode BASH_ONLY', () => {
    expect(RIGHT_SLOT_VIEWS[RightSlotView.TERMINAL].routingMode).toBe(TurnRoutingMode.BASH_ONLY)
  })

  it("the work view's minWidth defaults to CHAT_WORK_MIN_WIDTH", () => {
    expect(RIGHT_SLOT_VIEWS[RightSlotView.WORK].minWidth).toBe(CHAT_WORK_MIN_WIDTH)
  })

  it('the work view implies routing mode ALL_TOOLS', () => {
    expect(RIGHT_SLOT_VIEWS[RightSlotView.WORK].routingMode).toBe(TurnRoutingMode.ALL_TOOLS)
  })

  it('every registered view carries an id, label, title, and component for its own control', () => {
    for (const view of Object.values(RIGHT_SLOT_VIEWS)) {
      expect(typeof view.id).toBe('string')
      expect(typeof view.label).toBe('string')
      expect(typeof view.title).toBe('string')
      expect(view.component).toBeTruthy()
    }
  })
})

describe('resolveRightSlotRoutingMode', () => {
  it('resolves to the shown column own routing mode', () => {
    expect(
      resolveRightSlotRoutingMode(RightSlotView.TERMINAL, RIGHT_SLOT_VIEWS[RightSlotView.TERMINAL]),
    ).toBe(TurnRoutingMode.BASH_ONLY)
    expect(
      resolveRightSlotRoutingMode(RightSlotView.WORK, RIGHT_SLOT_VIEWS[RightSlotView.WORK]),
    ).toBe(TurnRoutingMode.ALL_TOOLS)
  })

  it('resolves the Focused view to FOCUSED and Everything to OFF', () => {
    expect(resolveRightSlotRoutingMode(RightSlotView.FOCUSED, null)).toBe(TurnRoutingMode.FOCUSED)
    expect(resolveRightSlotRoutingMode(RightSlotView.EVERYTHING, null)).toBe(TurnRoutingMode.OFF)
  })

  it('resolves a picked column that cannot fit to OFF - every call inline', () => {
    expect(resolveRightSlotRoutingMode(RightSlotView.TERMINAL, null)).toBe(TurnRoutingMode.OFF)
    expect(resolveRightSlotRoutingMode(RightSlotView.WORK, null)).toBe(TurnRoutingMode.OFF)
  })

  it('resolves to FOCUSED on a phone, whatever was picked', () => {
    expect(resolveRightSlotRoutingMode(RightSlotView.EVERYTHING, null, true)).toBe(
      TurnRoutingMode.FOCUSED,
    )
    expect(resolveRightSlotRoutingMode(RightSlotView.WORK, null, true)).toBe(
      TurnRoutingMode.FOCUSED,
    )
  })
})

describe('resolveStoredRightSlotView', () => {
  it('reads the newer rightSlotView key directly', () => {
    expect(resolveStoredRightSlotView({ rightSlotView: RightSlotView.WORK })).toBe(
      RightSlotView.WORK,
    )
    expect(resolveStoredRightSlotView({ rightSlotView: RightSlotView.EVERYTHING })).toBe(
      RightSlotView.EVERYTHING,
    )
  })

  it('falls back to the older boolean: true reads as terminal', () => {
    expect(resolveStoredRightSlotView({ terminalSplitEnabled: true })).toBe(RightSlotView.TERMINAL)
  })

  it('reads a column turned off before - the older off value or boolean false - as Everything', () => {
    expect(resolveStoredRightSlotView({ terminalSplitEnabled: false })).toBe(
      RightSlotView.EVERYTHING,
    )
    expect(resolveStoredRightSlotView({ rightSlotView: 'off' })).toBe(RightSlotView.EVERYTHING)
  })

  it('reads a session that never picked a view as Focused', () => {
    expect(resolveStoredRightSlotView({})).toBe(RightSlotView.FOCUSED)
    expect(resolveStoredRightSlotView(undefined)).toBe(RightSlotView.FOCUSED)
  })

  it('prefers the newer key over the older boolean when both are present', () => {
    expect(
      resolveStoredRightSlotView({ terminalSplitEnabled: true, rightSlotView: RightSlotView.WORK }),
    ).toBe(RightSlotView.WORK)
  })
})
