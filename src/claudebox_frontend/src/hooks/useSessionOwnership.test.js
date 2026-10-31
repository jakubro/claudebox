/** Tests for useSessionOwnership, driven through the id sequences the routing code produces. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BOUNCE, CREATE_FROM_A, SWITCH } from '../test-utils/sessionSequences'

const routing = { activeSessionId: null }
const data = { sessionId: null }
const events = {
  creations: { current: 0, bySeq: {} },
  isResumeRequestPending: false,
  isCreateRequestPending: false,
}

vi.mock('../context/SessionRoutingContext', () => ({ useSessionRouting: () => routing }))
vi.mock('../context/SessionDataContext', () => ({ useSessionId: () => data.sessionId }))
vi.mock('../context/StreamingStatusContext', () => ({
  useStreamingStatus: () => ({ ...events, getCreation: () => events.creations }),
}))

import useSessionOwnership from './useSessionOwnership'

function step(result, rerender, { routed, attached, resume = false, create = false, creations }) {
  routing.activeSessionId = routed
  data.sessionId = attached
  events.isResumeRequestPending = resume
  events.isCreateRequestPending = create
  if (creations) {
    events.creations = creations
  }
  rerender()
  return result.current
}

describe('useSessionOwnership', () => {
  beforeEach(() => {
    routing.activeSessionId = null
    data.sessionId = null
    events.creations = { current: 0, bySeq: {} }
    events.isResumeRequestPending = false
    events.isCreateRequestPending = false
  })

  it('SWITCH: attached only once the routed session has settled and attached', () => {
    const [a, empty, b] = SWITCH
    routing.activeSessionId = a
    data.sessionId = a
    const { result, rerender } = renderHook(() => useSessionOwnership())
    expect(result.current.isOwnerAttached).toBe(true)

    expect(step(result, rerender, { routed: b, attached: a, resume: true }).isOwnerAttached).toBe(
      false,
    )
    expect(step(result, rerender, { routed: b, attached: empty }).isOwnerAttached).toBe(false)

    const settled = step(result, rerender, { routed: b, attached: b })
    expect(settled.isOwnerAttached).toBe(true)
    expect(settled.ownerNow()).toEqual({ sessionId: 'B' })
  })

  it('BOUNCE: the owner stays the routed session throughout', () => {
    const [a, empty] = BOUNCE
    routing.activeSessionId = a
    data.sessionId = a
    const { result, rerender } = renderHook(() => useSessionOwnership())

    const mid = step(result, rerender, { routed: a, attached: empty, resume: true })
    expect(mid.ownerSessionId).toBe('A')
    expect(mid.ownerNow()).toEqual({ sessionId: 'A' })
  })

  it('CREATE_FROM_A: state made during the create belongs to it, resolving once it settles', () => {
    const [a, empty, c] = CREATE_FROM_A
    routing.activeSessionId = a
    data.sessionId = a
    const { result, rerender } = renderHook(() => useSessionOwnership())

    const pending = step(result, rerender, {
      routed: a,
      attached: empty,
      create: true,
      creations: {
        current: 1,
        bySeq: { 1: { status: 'pending', sessionId: null, fromRoute: 'A' } },
      },
    })
    const tag = pending.ownerNow()
    expect(tag).toEqual({ creation: 1 })
    expect(pending.resolveOwner(tag)).toBe(null)
    expect(pending.isOwnerAttached).toBe(false)

    const created = step(result, rerender, {
      routed: a,
      attached: c,
      creations: {
        current: 1,
        bySeq: { 1: { status: 'created', sessionId: 'C', fromRoute: 'A' } },
      },
    })
    expect(created.resolveOwner(tag)).toBe('C')
    expect(created.isOwnerAttached).toBe(true)

    const routedC = step(result, rerender, { routed: c, attached: c })
    expect(routedC.isRoutedOwner(tag)).toBe(true)
  })

  it('a welcome owner resolves to creation 1 only, never to creation 2', () => {
    const { result, rerender } = renderHook(() => useSessionOwnership())
    const tag = result.current.ownerNow()
    expect(tag).toEqual({ creation: 1 })

    const failed = step(result, rerender, {
      routed: null,
      attached: null,
      creations: {
        current: 2,
        bySeq: {
          1: { status: 'failed', sessionId: null, fromRoute: null },
          2: { status: 'created', sessionId: 'sess-d', fromRoute: null },
        },
      },
    })
    expect(failed.resolveOwner(tag)).toBe(null)
    expect(failed.isOrphaned(tag)).toBe(true)
  })
})
