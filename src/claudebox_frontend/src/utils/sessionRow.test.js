/** Tests for sessionRow.js - a session's dot state and a row's needs-you reason. */

import { describe, expect, it } from 'vitest'
import { sessionDotState, sessionRowDisplay } from './sessionRow'

const mkSession = (id, opts = {}) => ({
  session_id: id,
  num_turns: 1,
  parent_session_id: null,
  ...opts,
})

describe('sessionRowDisplay', () => {
  const statuses = { running: 'running', stopping: 'stopping' }
  const derive = (sessionId, _sessions, containerId) =>
    containerId ? (statuses[sessionId] ?? 'running') : 'none'
  const asking = (id, opts = {}) => mkSession(id, { needs_user: `Decide: ${id}`, ...opts })

  it('shows a running session that needs you with its reason', () => {
    expect(sessionRowDisplay(asking('running', { container_id: 'c1' }), derive)).toEqual({
      status: 'running',
      dot: 'needs-you',
      reason: 'Decide: running',
    })
  })

  it('shows a session that stopped while it needed you as stopped, without the reason', () => {
    expect(sessionRowDisplay(asking('gone'), derive)).toEqual({
      status: 'none',
      dot: 'none',
      reason: null,
    })
  })

  it('shows a stopping session as stopping, without the reason', () => {
    expect(sessionRowDisplay(asking('stopping', { container_id: 'c1' }), derive)).toEqual({
      status: 'stopping',
      dot: 'stopping',
      reason: null,
    })
  })

  it('shows a running session that does not need you as running', () => {
    expect(sessionRowDisplay(mkSession('idle', { container_id: 'c1' }), derive)).toEqual({
      status: 'running',
      dot: 'running',
      reason: null,
    })
  })

  it('gives a collapsed row the needs-you dot of a running fork beneath it, but not its reason', () => {
    const parent = mkSession('parent')
    const hidden = [
      mkSession('child', { container_id: 'c2' }),
      asking('grandchild', { container_id: 'c3' }),
    ]

    expect(sessionRowDisplay(parent, derive, hidden)).toEqual({
      status: 'none',
      dot: 'needs-you',
      reason: null,
    })
  })

  it('ignores a hidden fork that needs you once its container is gone', () => {
    const parent = mkSession('parent', { container_id: 'c1' })

    expect(sessionRowDisplay(parent, derive, [asking('child')]).dot).toBe('running')
  })

  it('keeps a stopping row stopping whatever its hidden forks are doing', () => {
    const parent = mkSession('stopping', { container_id: 'c1' })

    expect(sessionRowDisplay(parent, derive, [asking('child', { container_id: 'c2' })]).dot).toBe(
      'stopping',
    )
  })

  it('shows a working session as working, even after it asked for you, without the reason', () => {
    const working = asking('running', { container_id: 'c1', activity: 'working' })

    expect(sessionRowDisplay(working, derive)).toEqual({
      status: 'running',
      dot: 'working',
      reason: null,
    })
  })

  it('shows a session waiting on background work as waiting', () => {
    const waiting = mkSession('running', { container_id: 'c1', activity: 'waiting' })

    expect(sessionRowDisplay(waiting, derive).dot).toBe('waiting')
  })

  it('shows that a session needs you over the background work it still waits on', () => {
    const both = asking('running', { container_id: 'c1', activity: 'waiting' })

    expect(sessionRowDisplay(both, derive)).toEqual({
      status: 'running',
      dot: 'needs-you',
      reason: 'Decide: running',
    })
  })

  it('never shows work without a running container, and shows stopping over it', () => {
    expect(sessionRowDisplay(mkSession('gone', { activity: 'working' }), derive).dot).toBe('none')
    expect(
      sessionRowDisplay(mkSession('stopping', { container_id: 'c1', activity: 'working' }), derive)
        .dot,
    ).toBe('stopping')
  })

  it('gives a folded row the highest-ranked state among its hidden forks', () => {
    const parent = mkSession('parent')
    const fork = (id, opts) => mkSession(id, { container_id: `ctr-${id}`, ...opts })

    expect(
      sessionRowDisplay(parent, derive, [
        fork('waits', { activity: 'waiting' }),
        asking('asks', { container_id: 'c2' }),
        fork('works', { activity: 'working' }),
      ]).dot,
    ).toBe('working')
    expect(
      sessionRowDisplay(parent, derive, [
        fork('waits', { activity: 'waiting' }),
        asking('asks', { container_id: 'c2' }),
      ]).dot,
    ).toBe('needs-you')
    expect(sessionRowDisplay(parent, derive, [fork('waits', { activity: 'waiting' })]).dot).toBe(
      'waiting',
    )
  })
})

describe('sessionDotState', () => {
  it.each([
    ['stopping', { activity: 'working', needs_user: 'Decide: x' }, 'stopping'],
    ['none', { activity: 'working' }, 'none'],
    ['running', { activity: 'working', needs_user: 'Decide: x' }, 'working'],
    ['running', { activity: 'waiting', needs_user: 'Decide: x' }, 'needs-you'],
    ['running', { activity: 'waiting' }, 'waiting'],
    ['running', {}, 'running'],
  ])('a %s container with %o shows %s', (status, session, expected) => {
    expect(sessionDotState(status, session)).toBe(expected)
  })

  it('shows the container status for a session the listing does not hold yet', () => {
    expect(sessionDotState('running', undefined)).toBe('running')
  })
})
