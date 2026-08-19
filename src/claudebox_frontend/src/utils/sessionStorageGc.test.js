/** Tests for sessionStorageGc - dead-session localStorage sweep. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/sessions', () => ({ listSessionsForWorkspace: vi.fn() }))
vi.mock('../api/workspaces', () => ({ listWorkspaces: vi.fn() }))

import { listSessionsForWorkspace } from '../api/sessions'
import { listWorkspaces } from '../api/workspaces'
import { collectLiveSessionIdsAcrossWorkspaces, sweepDeadSessionStorage } from './sessionStorageGc'

describe('sweepDeadSessionStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('removes keys for sessions that no longer exist, across all four namespaces', () => {
    localStorage.setItem('draft:dead-session', '{}')
    localStorage.setItem('inputHistory:dead-session', '[]')
    localStorage.setItem('inline-replies:dead-session', '[]')
    localStorage.setItem('queue:dead-session', '[]')

    sweepDeadSessionStorage(['live-session'])

    expect(localStorage.getItem('draft:dead-session')).toBeNull()
    expect(localStorage.getItem('inputHistory:dead-session')).toBeNull()
    expect(localStorage.getItem('inline-replies:dead-session')).toBeNull()
    expect(localStorage.getItem('queue:dead-session')).toBeNull()
  })

  it('leaves keys for live sessions untouched', () => {
    localStorage.setItem('draft:live-session', '{"current":"hi"}')

    sweepDeadSessionStorage(['live-session'])

    expect(localStorage.getItem('draft:live-session')).toBe('{"current":"hi"}')
  })

  it('never touches global keys outside the four session-scoped prefixes', () => {
    localStorage.setItem('claudebox-workspace-id', 'my-workspace')
    localStorage.setItem('claudebox-bookmarks-changed', '12345')
    localStorage.setItem('claudebox-pins-changed', '12345')

    sweepDeadSessionStorage([])

    expect(localStorage.getItem('claudebox-workspace-id')).toBe('my-workspace')
    expect(localStorage.getItem('claudebox-bookmarks-changed')).toBe('12345')
    expect(localStorage.getItem('claudebox-pins-changed')).toBe('12345')
  })

  it('an empty live-session list sweeps every session-scoped key', () => {
    localStorage.setItem('draft:s1', '{}')
    localStorage.setItem('inputHistory:s2', '[]')

    sweepDeadSessionStorage([])

    expect(localStorage.length).toBe(0)
  })

  it('returns the removed keys', () => {
    localStorage.setItem('draft:dead', '{}')
    localStorage.setItem('draft:live', '{}')

    const removed = sweepDeadSessionStorage(['live'])

    expect(removed).toEqual(['draft:dead'])
  })

  it('does nothing when every session-scoped key belongs to a live session', () => {
    localStorage.setItem('draft:live', '{}')
    localStorage.setItem('inputHistory:live', '[]')

    const removed = sweepDeadSessionStorage(['live'])

    expect(removed).toEqual([])
    expect(localStorage.getItem('draft:live')).toBe('{}')
    expect(localStorage.getItem('inputHistory:live')).toBe('[]')
  })
})

describe('collectLiveSessionIdsAcrossWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes a session that is live in another workspace, not just the current one', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-a' }, { id: 'ws-b' }])
    listSessionsForWorkspace.mockResolvedValue({ sessions: [{ session_id: 'other-ws-session' }] })

    const ids = await collectLiveSessionIdsAcrossWorkspaces('ws-a', ['current-ws-session'])

    expect(ids.has('current-ws-session')).toBe(true)
    expect(ids.has('other-ws-session')).toBe(true)
    expect(listSessionsForWorkspace).toHaveBeenCalledWith('ws-b')
    expect(listSessionsForWorkspace).not.toHaveBeenCalledWith('ws-a')
  })

  it('falls back to the current workspace alone when the workspace list fetch fails', async () => {
    listWorkspaces.mockRejectedValue(new Error('daemon unreachable'))

    const ids = await collectLiveSessionIdsAcrossWorkspaces('ws-a', ['current-ws-session'])

    expect(ids).toEqual(new Set(['current-ws-session']))
    expect(listSessionsForWorkspace).not.toHaveBeenCalled()
  })

  it('a single failing workspace contributes nothing but does not block the others', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-a' }, { id: 'ws-b' }, { id: 'ws-c' }])
    listSessionsForWorkspace.mockImplementation(id =>
      id === 'ws-b'
        ? Promise.reject(new Error('ws-b unreachable'))
        : Promise.resolve({ sessions: [{ session_id: `${id}-session` }] }),
    )

    const ids = await collectLiveSessionIdsAcrossWorkspaces('ws-a', [])

    expect(ids.has('ws-c-session')).toBe(true)
    expect(ids.has('ws-b-session')).toBe(false)
  })

  it('a single workspace with no sessions elsewhere returns only the current live set', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-a' }])

    const ids = await collectLiveSessionIdsAcrossWorkspaces('ws-a', ['current-ws-session'])

    expect(ids).toEqual(new Set(['current-ws-session']))
    expect(listSessionsForWorkspace).not.toHaveBeenCalled()
  })

  it('tolerates a fulfilled response with no sessions field', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-a' }, { id: 'ws-b' }])
    listSessionsForWorkspace.mockResolvedValue({})

    const ids = await collectLiveSessionIdsAcrossWorkspaces('ws-a', ['current-ws-session'])

    expect(ids).toEqual(new Set(['current-ws-session']))
  })
})
