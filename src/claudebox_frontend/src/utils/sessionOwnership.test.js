/** Tests for the owner rules of per-session state. */

import { describe, expect, it } from 'vitest'
import {
  isOpenFor,
  isOrphanedTag,
  isOwnerAttachedFor,
  ownerSessionIdOf,
  ownerTagFor,
  resolveOwnerTag,
  toggleOpenFor,
} from './sessionOwnership'

const NONE = { current: 0, bySeq: {} }

function creation(seq, status, sessionId = null, fromRoute = null) {
  return { current: seq, bySeq: { [seq]: { status, sessionId, fromRoute } } }
}

describe('ownerTagFor', () => {
  it('names the routed session', () => {
    expect(ownerTagFor({ routedSessionId: 'A', creations: NONE })).toEqual({ sessionId: 'A' })
  })

  it('names the next creation on the welcome screen', () => {
    expect(ownerTagFor({ routedSessionId: null, creations: creation(1, 'failed') })).toEqual({
      creation: 2,
    })
  })

  it('names the open creation while one is pending', () => {
    expect(
      ownerTagFor({ routedSessionId: 'A', creations: creation(4, 'pending', null, 'A') }),
    ).toEqual({
      creation: 4,
    })
  })

  it('names the routed session once the route has reached the created one', () => {
    expect(
      ownerTagFor({ routedSessionId: 'C', creations: creation(4, 'created', 'C', 'A') }),
    ).toEqual({ sessionId: 'C' })
  })
})

describe('resolveOwnerTag', () => {
  it('resolves a creation only once it has produced its session', () => {
    expect(resolveOwnerTag({ creation: 1 }, creation(1, 'pending'))).toBe(null)
    expect(resolveOwnerTag({ creation: 1 }, creation(1, 'created', 'sess-c'))).toBe('sess-c')
  })

  it("never resolves to a later creation's session", () => {
    const record = {
      current: 2,
      bySeq: {
        1: { status: 'pending', sessionId: null, fromRoute: null },
        2: { status: 'created', sessionId: 'sess-d', fromRoute: null },
      },
    }

    expect(resolveOwnerTag({ creation: 1 }, record)).toBe(null)
  })

  it('reads a failed creation as orphaned', () => {
    expect(isOrphanedTag({ creation: 1 }, creation(1, 'failed'))).toBe(true)
    expect(isOrphanedTag({ sessionId: 'A' }, creation(1, 'failed'))).toBe(false)
  })
})

describe('ownerSessionIdOf and isOwnerAttachedFor', () => {
  const attached = (routed, attachedId, creations = NONE, pending = {}) =>
    isOwnerAttachedFor({
      routedSessionId: routed,
      attachedSessionId: attachedId,
      creations,
      isResumeRequestPending: pending.resume ?? false,
      isCreateRequestPending: pending.create ?? false,
    })

  it('holds only while the routed session is the attached one and nothing is pending', () => {
    expect(attached('A', 'A')).toBe(true)
    expect(attached('B', 'A')).toBe(false)
    expect(attached('B', 'B', NONE, { resume: true })).toBe(false)
    expect(attached(null, null)).toBe(false)
  })

  it("has no owner session while a creation is pending, then the created one's", () => {
    expect(
      ownerSessionIdOf({ routedSessionId: 'A', creations: creation(1, 'pending', null, 'A') }),
    ).toBe(null)
    expect(
      ownerSessionIdOf({ routedSessionId: 'A', creations: creation(1, 'created', 'C', 'A') }),
    ).toBe('C')
  })
})

describe('view state opened for a routed session', () => {
  it('is open only on the session it was opened for', () => {
    expect(isOpenFor('A', 'A')).toBe(true)
    expect(isOpenFor('A', 'B')).toBe(false)
    expect(isOpenFor(null, null)).toBe(false)
  })

  it('toggles closed where it is open, and open on the session now routed elsewhere', () => {
    expect(toggleOpenFor('A', 'A')).toBeNull()
    expect(toggleOpenFor('A', 'B')).toBe('B')
    expect(toggleOpenFor(null, 'B')).toBe('B')
  })
})
