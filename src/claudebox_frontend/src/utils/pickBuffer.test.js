/** Tests for what becomes of picker changes made before their session is on screen. */

import { describe, expect, it } from 'vitest'
import { PickFate, pickBufferFate, sameOwner } from './pickBuffer'

const WELCOME_PICK = { owner: { creation: 1 }, workspaceId: 'ws-1', model: 'sonnet' }

function world(overrides = {}) {
  return {
    workspaceId: 'ws-1',
    routedSessionId: null,
    attachedSessionId: null,
    isOwnerAttached: false,
    creations: { current: 0, bySeq: {} },
    ...overrides,
  }
}

function withCreation(status, sessionId = null) {
  return { current: 1, bySeq: { 1: { status, sessionId, fromRoute: null } } }
}

describe('pickBufferFate', () => {
  it('waits on the welcome screen', () => {
    expect(pickBufferFate(WELCOME_PICK, world())).toBe(PickFate.WAIT)
  })

  it('discards a pick once the workspace changes', () => {
    expect(pickBufferFate(WELCOME_PICK, world({ workspaceId: 'ws-2' }))).toBe(PickFate.DISCARD)
  })

  it('waits while its creation is pending', () => {
    expect(pickBufferFate(WELCOME_PICK, world({ creations: withCreation('pending') }))).toBe(
      PickFate.WAIT,
    )
  })

  it('moves to the next creation when its own fails', () => {
    expect(pickBufferFate(WELCOME_PICK, world({ creations: withCreation('failed') }))).toBe(
      PickFate.REBIND,
    )
  })

  it('drains into the session its creation made, once attached', () => {
    const attached = world({
      creations: withCreation('created', 'S'),
      attachedSessionId: 'S',
      isOwnerAttached: true,
    })

    expect(pickBufferFate(WELCOME_PICK, attached)).toBe(PickFate.DRAIN)
  })

  it('discards when a session other than its creation attaches', () => {
    const opened = world({ routedSessionId: 'X', attachedSessionId: 'X', isOwnerAttached: true })

    expect(pickBufferFate(WELCOME_PICK, opened)).toBe(PickFate.DISCARD)
  })

  it('discards a pick for a routed session once the route moves on', () => {
    const pick = { owner: { sessionId: 'B' }, workspaceId: 'ws-1', model: 'sonnet' }

    expect(pickBufferFate(pick, world({ routedSessionId: 'C' }))).toBe(PickFate.DISCARD)
  })
})

describe('sameOwner', () => {
  it('tells a session from a creation', () => {
    expect(sameOwner({ sessionId: 'A' }, { creation: 1 })).toBe(false)
    expect(sameOwner({ creation: 1 }, { creation: 1 })).toBe(true)
  })
})
