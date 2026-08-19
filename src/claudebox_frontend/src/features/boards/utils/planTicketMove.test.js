/** Tests for planTicketMove - bulk ticket move decision logic. */

import { describe, expect, it } from 'vitest'
import { planTicketMove } from './planTicketMove'

describe('planTicketMove', () => {
  it('returns null when the ticket is already at the destination', () => {
    const ticket = { column: 'backlog', swimlane: 'frontend' }
    const result = planTicketMove({
      ticket,
      targetCol: 'backlog',
      targetSwimlane: 'frontend',
      isCrossLaneMove: false,
      nextIndex: undefined,
    })
    expect(result).toBeNull()
  })

  it('moves column only when swimlane target is null (column-header drop)', () => {
    const ticket = { column: 'backlog', swimlane: 'frontend' }
    const result = planTicketMove({
      ticket,
      targetCol: 'done',
      targetSwimlane: null,
      isCrossLaneMove: false,
      nextIndex: undefined,
    })
    expect(result).toEqual({
      body: { column: 'done', swimlane: undefined, index: undefined },
      advanceIndex: false,
    })
  })

  it('changes lane on a single-lane cell drop that differs from the origin lane', () => {
    const ticket = { column: 'backlog', swimlane: 'frontend' }
    const result = planTicketMove({
      ticket,
      targetCol: 'backlog',
      targetSwimlane: 'backend',
      isCrossLaneMove: false,
      nextIndex: undefined,
    })
    expect(result.body.swimlane).toBe('backend')
    expect(result.body.column).toBeUndefined()
  })

  it('never changes lane on a cross-lane bulk drop', () => {
    const ticket = { column: 'backlog', swimlane: 'frontend' }
    const result = planTicketMove({
      ticket,
      targetCol: 'done',
      targetSwimlane: 'backend',
      isCrossLaneMove: true,
      nextIndex: undefined,
    })
    expect(result.body.swimlane).toBeUndefined()
    expect(result.body.column).toBe('done')
  })

  it('applies index only when the ticket lands in the drop target lane', () => {
    const ticket = { column: 'backlog', swimlane: 'frontend' }
    const result = planTicketMove({
      ticket,
      targetCol: 'backlog',
      targetSwimlane: 'frontend',
      isCrossLaneMove: false,
      nextIndex: 2,
    })
    expect(result.body.index).toBe(2)
    expect(result.advanceIndex).toBe(true)
  })

  it('omits index when nextIndex is null or undefined', () => {
    const ticket = { column: 'backlog', swimlane: 'frontend' }
    const result = planTicketMove({
      ticket,
      targetCol: 'done',
      targetSwimlane: null,
      isCrossLaneMove: false,
      nextIndex: null,
    })
    expect(result.body.index).toBeUndefined()
    expect(result.advanceIndex).toBe(false)
  })

  it('treats a ticket with no swimlane as __unsorted__ for lane-change comparison', () => {
    const ticket = { column: 'backlog' }
    const result = planTicketMove({
      ticket,
      targetCol: 'backlog',
      targetSwimlane: '__unsorted__',
      isCrossLaneMove: false,
      nextIndex: undefined,
    })
    expect(result).toBeNull()
  })

  it('never sends the literal __unsorted__ swimlane value in the request body', () => {
    const ticket = { column: 'backlog', swimlane: 'frontend' }
    const result = planTicketMove({
      ticket,
      targetCol: 'done',
      targetSwimlane: '__unsorted__',
      isCrossLaneMove: false,
      nextIndex: undefined,
    })
    expect(result.body.swimlane).toBeUndefined()
  })
})
