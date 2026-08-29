/** Tests for the promoted-thread fold boundary derivation. */

import { describe, expect, it } from 'vitest'
import { computeFoldBoundary, isForkDivider, resolveForkParentId } from './turnFold'

function turn(settingChanges = []) {
  return { settingChanges }
}

function forkDivider(forkParentId = 'source-session') {
  return {
    type: 'system',
    subtype: 'container_restarted',
    message_data: { fork_parent_session_id: forkParentId },
  }
}

function restartDivider() {
  return { type: 'system', subtype: 'container_restarted', message_data: null }
}

describe('computeFoldBoundary', () => {
  it('a fork divider mid-way folds exactly the turns above it', () => {
    const turns = [turn(), turn(), turn([forkDivider()]), turn(), turn()]
    expect(computeFoldBoundary(turns, true)).toBe(2)
  })

  it('a fork divider on the first turn folds only that one - no minimum run', () => {
    const turns = [turn([forkDivider()]), turn()]
    expect(computeFoldBoundary(turns, true)).toBe(0)
  })

  it('no divider anywhere folds nothing', () => {
    const turns = [turn(), turn(), turn()]
    expect(computeFoldBoundary(turns, true)).toBe(-1)
  })

  it('a plain restart divider with no fork parent folds nothing', () => {
    const turns = [turn([restartDivider()]), turn()]
    expect(computeFoldBoundary(turns, true)).toBe(-1)
  })

  it('a session without the side-conversation marker folds nothing, however many dividers it has', () => {
    const turns = [turn([forkDivider()]), turn([forkDivider()])]
    expect(computeFoldBoundary(turns, false)).toBe(-1)
  })

  it('an empty turn list folds nothing', () => {
    expect(computeFoldBoundary([], true)).toBe(-1)
  })

  it('a fork-of-a-fork: two dividers present, the LAST one is the boundary', () => {
    // The inherited ancestor divider precedes this thread's own, and both carry a fork parent -
    // only position tells them apart.
    const turns = [turn([forkDivider('ancestor-session')]), turn([forkDivider('this-session')])]
    expect(computeFoldBoundary(turns, true)).toBe(1)
  })
})

describe('isForkDivider', () => {
  it('requires type, subtype, and a fork parent id together', () => {
    expect(isForkDivider(forkDivider())).toBe(true)
    expect(isForkDivider(restartDivider())).toBe(false)
    expect(isForkDivider({ ...forkDivider(), type: 'user' })).toBe(false)
  })
})

describe('resolveForkParentId', () => {
  it('names the source session at the boundary turn', () => {
    const turns = [turn(), turn([forkDivider('source-x')]), turn()]
    expect(resolveForkParentId(turns, 1)).toBe('source-x')
  })

  it('returns null when there is no boundary', () => {
    const turns = [turn(), turn()]
    expect(resolveForkParentId(turns, -1)).toBeNull()
  })
})
