/** Tests for laneTickets - pure swimlane ticket filtering. */

import { describe, expect, it } from 'vitest'
import { getLaneTickets } from './laneTickets'

describe('getLaneTickets', () => {
  it('returns an empty array when allTickets is falsy', () => {
    expect(getLaneTickets(null, 'frontend', false, ['frontend'])).toEqual([])
  })

  it('collects tickets matching the lane id across every column', () => {
    const allTickets = {
      backlog: [
        { path: 'a', swimlane: 'frontend' },
        { path: 'b', swimlane: 'backend' },
      ],
      done: [{ path: 'c', swimlane: 'frontend' }],
    }
    const result = getLaneTickets(allTickets, 'frontend', false, ['frontend', 'backend'])
    expect(result.map(t => t.path)).toEqual(['a', 'c'])
  })

  it('unsorted lane sweeps tickets whose swimlane is not a known id', () => {
    const allTickets = {
      backlog: [
        { path: 'a', swimlane: 'frontend' },
        { path: 'b', swimlane: 'unknown-lane' },
        { path: 'c' },
      ],
    }
    const result = getLaneTickets(allTickets, '__unsorted__', true, ['frontend'])
    expect(result.map(t => t.path)).toEqual(['b', 'c'])
  })

  it('unsorted lane excludes tickets whose swimlane is a known id', () => {
    const allTickets = {
      backlog: [{ path: 'a', swimlane: 'frontend' }],
    }
    expect(getLaneTickets(allTickets, '__unsorted__', true, ['frontend'])).toEqual([])
  })

  it('treats a missing swimlaneIds list as matching nothing in the unsorted lane', () => {
    const allTickets = {
      backlog: [{ path: 'a', swimlane: 'frontend' }],
    }
    const result = getLaneTickets(allTickets, '__unsorted__', true, undefined)
    expect(result.map(t => t.path)).toEqual(['a'])
  })
})
