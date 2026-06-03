/** Tests for SessionRoutingContext (hash-based routing). */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRoutingProvider, useSessionRouting } from './SessionRoutingContext'
import { buildTurnSegment, parseHash } from './utils/sessionRouting'

describe('useSessionRouting', () => {
  let originalHash

  beforeEach(() => {
    originalHash = window.location.hash
    window.location.hash = ''
  })

  afterEach(() => {
    window.location.hash = originalHash
  })

  const wrapper = ({ children }) => <SessionRoutingProvider>{children}</SessionRoutingProvider>

  it('throws when used outside SessionRoutingProvider', () => {
    expect(() => renderHook(() => useSessionRouting())).toThrow(
      'useSessionRouting must be used within SessionRoutingProvider',
    )
  })

  it('returns null state when no hash present', () => {
    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeWorkspaceId).toBeNull()
    expect(result.current.activeSessionId).toBeNull()
    expect(result.current.activeTurnId).toBeNull()
    expect(result.current.activeMessageType).toBeNull()
  })

  it('parses initial hash into workspace and session IDs', () => {
    window.location.hash = '#/workspaces/my-ws/sessions/sess-123'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeWorkspaceId).toBe('my-ws')
    expect(result.current.activeSessionId).toBe('sess-123')
    expect(result.current.activeTurnId).toBeNull()
    expect(result.current.activeMessageType).toBeNull()
  })

  it('parses turn segment with user role prefix', () => {
    window.location.hash = '#/workspaces/ws/sessions/sess/turns/u-turn-abc'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeSessionId).toBe('sess')
    expect(result.current.activeTurnId).toBe('turn-abc')
    expect(result.current.activeMessageType).toBe('user')
  })

  it('parses turn segment with assistant role prefix', () => {
    window.location.hash = '#/workspaces/ws/sessions/sess/turns/a-turn-xyz'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeMessageType).toBe('assistant')
    expect(result.current.activeTurnId).toBe('turn-xyz')
  })

  it('navigateToSession updates hash and state', () => {
    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    act(() => {
      result.current.navigateToSession('ws-1', 'sess-abc')
    })

    expect(window.location.hash).toBe('#/workspaces/ws-1/sessions/sess-abc')
  })

  it('navigateToSession with turn option appends /turns/<role>-<id>', () => {
    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    act(() => {
      result.current.navigateToSession('ws-1', 'sess-abc', {
        turnId: 'turn-1',
        messageType: 'user',
      })
    })

    expect(window.location.hash).toBe('#/workspaces/ws-1/sessions/sess-abc/turns/u-turn-1')
  })

  it('navigateToSession with assistant turn option uses a- prefix', () => {
    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    act(() => {
      result.current.navigateToSession('ws-1', 'sess-abc', {
        turnId: 'turn-2',
        messageType: 'assistant',
      })
    })

    expect(window.location.hash).toBe('#/workspaces/ws-1/sessions/sess-abc/turns/a-turn-2')
  })

  it('navigateToSession with partial turn option (missing messageType) omits segment', () => {
    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    act(() => {
      result.current.navigateToSession('ws-1', 'sess-abc', { turnId: 'turn-1' })
    })

    expect(window.location.hash).toBe('#/workspaces/ws-1/sessions/sess-abc')
  })

  it('navigateHome clears hash and state', () => {
    window.location.hash = '#/workspaces/ws-1/sessions/sess-1'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeSessionId).toBe('sess-1')

    act(() => {
      result.current.navigateHome()
    })

    expect(result.current.activeSessionId).toBeNull()
    expect(result.current.activeWorkspaceId).toBeNull()
    // pushState removes hash — no bare '#'
    expect(window.location.hash).toBe('')
  })

  it('rejects invalid hash patterns', () => {
    window.location.hash = '#/invalid/path'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeWorkspaceId).toBeNull()
    expect(result.current.activeSessionId).toBeNull()
  })

  it('strips query params from hash before parsing', () => {
    window.location.hash = '#/workspaces/ws-1/sessions/sess-1?foo=bar'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeWorkspaceId).toBe('ws-1')
    expect(result.current.activeSessionId).toBe('sess-1')
  })

  it('parses turn segment alongside query params', () => {
    window.location.hash = '#/workspaces/ws/sessions/sess/turns/u-turn-1?density=terse'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeTurnId).toBe('turn-1')
    expect(result.current.activeMessageType).toBe('user')
    expect(result.current.density).toBe('terse')
  })

  it('allows hyphens and underscores in IDs', () => {
    window.location.hash = '#/workspaces/my_workspace-1/sessions/session_abc-123'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeWorkspaceId).toBe('my_workspace-1')
    expect(result.current.activeSessionId).toBe('session_abc-123')
  })

  it('exposes navigateToSession, navigateToWorkspace, navigateHome, replaceTurnInUrl', () => {
    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(typeof result.current.navigateToSession).toBe('function')
    expect(typeof result.current.navigateToWorkspace).toBe('function')
    expect(typeof result.current.navigateHome).toBe('function')
    expect(typeof result.current.replaceTurnInUrl).toBe('function')
  })

  it('parses workspace-only hash', () => {
    window.location.hash = '#/workspaces/my-ws'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeWorkspaceId).toBe('my-ws')
    expect(result.current.activeSessionId).toBeNull()
  })

  it('navigateToWorkspace sets hash to workspace path', () => {
    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    act(() => {
      result.current.navigateToWorkspace('ws-1')
    })

    expect(window.location.hash).toBe('#/workspaces/ws-1')
  })

  it('allows dots in workspace IDs', () => {
    window.location.hash = '#/workspaces/my.workspace'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.activeWorkspaceId).toBe('my.workspace')
  })

  it('density defaults to comfortable when query param absent', () => {
    window.location.hash = '#/workspaces/my-ws/boards/sprint-1'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.density).toBe('comfortable')
  })

  it('density resolves to terse when query param matches', () => {
    window.location.hash = '#/workspaces/my-ws/boards/sprint-1?density=terse'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.density).toBe('terse')
  })

  it('density falls back to comfortable for malformed query value', () => {
    window.location.hash = '#/workspaces/my-ws/boards/sprint-1?density=foo'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    expect(result.current.density).toBe('comfortable')
  })

  it('setDensity rewrites hash via replaceState and updates state', () => {
    window.location.hash = '#/workspaces/my-ws/boards/sprint-1'
    const replaceStateSpy = vi.spyOn(history, 'replaceState')

    const { result } = renderHook(() => useSessionRouting(), { wrapper })
    expect(result.current.density).toBe('comfortable')

    act(() => {
      result.current.setDensity('terse')
    })

    expect(result.current.density).toBe('terse')
    expect(replaceStateSpy).toHaveBeenCalled()
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1]
    expect(lastCall[2]).toContain('density=terse')

    act(() => {
      result.current.setDensity('comfortable')
    })

    expect(result.current.density).toBe('comfortable')
    const finalCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1]
    expect(finalCall[2]).not.toContain('density=')

    replaceStateSpy.mockRestore()
  })

  it('replaceTurnInUrl uses history.replaceState and updates state', () => {
    window.location.hash = '#/workspaces/ws/sessions/sess'
    const replaceStateSpy = vi.spyOn(history, 'replaceState')

    const { result } = renderHook(() => useSessionRouting(), { wrapper })
    expect(result.current.activeTurnId).toBeNull()

    act(() => {
      result.current.replaceTurnInUrl('turn-1', 'user')
    })

    expect(result.current.activeTurnId).toBe('turn-1')
    expect(result.current.activeMessageType).toBe('user')
    expect(replaceStateSpy).toHaveBeenCalled()
    const lastCall = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1]
    expect(lastCall[2]).toContain('/turns/u-turn-1')

    replaceStateSpy.mockRestore()
  })

  it('replaceTurnInUrl with null clears the turn segment', () => {
    window.location.hash = '#/workspaces/ws/sessions/sess/turns/a-turn-1'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })
    expect(result.current.activeTurnId).toBe('turn-1')

    act(() => {
      result.current.replaceTurnInUrl(null, null)
    })

    expect(result.current.activeTurnId).toBeNull()
    expect(result.current.activeMessageType).toBeNull()
    expect(window.location.hash).toBe('#/workspaces/ws/sessions/sess')
  })

  it('replaceTurnInUrl preserves query string', () => {
    window.location.hash = '#/workspaces/ws/sessions/sess?density=terse'

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    act(() => {
      result.current.replaceTurnInUrl('turn-1', 'assistant')
    })

    expect(window.location.hash).toBe('#/workspaces/ws/sessions/sess/turns/a-turn-1?density=terse')
  })

  it('replaceTurnInUrl is a no-op when hash has no session', () => {
    window.location.hash = '#/workspaces/ws'
    const replaceStateSpy = vi.spyOn(history, 'replaceState')

    const { result } = renderHook(() => useSessionRouting(), { wrapper })

    act(() => {
      result.current.replaceTurnInUrl('turn-1', 'user')
    })

    // No new replaceState call after the initial provider setup.
    const callsAfter = replaceStateSpy.mock.calls.filter(c =>
      typeof c[2] === 'string' ? c[2].includes('/turns/') : false,
    )
    expect(callsAfter).toHaveLength(0)
    expect(result.current.activeTurnId).toBeNull()

    replaceStateSpy.mockRestore()
  })
})

describe('parseHash', () => {
  it('parses workspace + session hash', () => {
    expect(parseHash('#/workspaces/ws/sessions/sess')).toEqual({
      workspaceId: 'ws',
      sessionId: 'sess',
      boardId: null,
      turnId: null,
      messageType: null,
      density: 'comfortable',
    })
  })

  it('parses workspace-only hash', () => {
    expect(parseHash('#/workspaces/ws')).toEqual({
      workspaceId: 'ws',
      sessionId: null,
      boardId: null,
      turnId: null,
      messageType: null,
      density: 'comfortable',
    })
  })

  it('parses board hash', () => {
    expect(parseHash('#/workspaces/ws/boards/my-board')).toEqual({
      workspaceId: 'ws',
      sessionId: null,
      boardId: 'my-board',
      turnId: null,
      messageType: null,
      density: 'comfortable',
    })
  })

  it('parses session + user turn hash', () => {
    expect(parseHash('#/workspaces/ws/sessions/sess/turns/u-tid-1')).toEqual({
      workspaceId: 'ws',
      sessionId: 'sess',
      boardId: null,
      turnId: 'tid-1',
      messageType: 'user',
      density: 'comfortable',
    })
  })

  it('parses session + assistant turn hash', () => {
    expect(parseHash('#/workspaces/ws/sessions/sess/turns/a-tid-2')).toEqual({
      workspaceId: 'ws',
      sessionId: 'sess',
      boardId: null,
      turnId: 'tid-2',
      messageType: 'assistant',
      density: 'comfortable',
    })
  })

  it('returns null for invalid hash', () => {
    expect(parseHash('#/invalid')).toBeNull()
    expect(parseHash('')).toBeNull()
  })

  it('returns null for malformed turn role prefix', () => {
    // Only `u-` and `a-` are valid role prefixes.
    expect(parseHash('#/workspaces/ws/sessions/sess/turns/x-tid')).toBeNull()
  })
})

describe('buildTurnSegment', () => {
  it('returns empty string when both inputs missing', () => {
    expect(buildTurnSegment(null, null)).toBe('')
    expect(buildTurnSegment(undefined, undefined)).toBe('')
  })

  it('returns empty string when only one input present', () => {
    expect(buildTurnSegment('tid', null)).toBe('')
    expect(buildTurnSegment(null, 'user')).toBe('')
  })

  it('serializes user role with u- prefix', () => {
    expect(buildTurnSegment('tid-1', 'user')).toBe('/turns/u-tid-1')
  })

  it('serializes assistant role with a- prefix', () => {
    expect(buildTurnSegment('tid-2', 'assistant')).toBe('/turns/a-tid-2')
  })
})
