/** Tests for useSessionRail - composes the rail's rendered groups and focus-move navigation. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import useSessionRail from './useSessionRail'

vi.mock('../../../context/SessionsContext')
vi.mock('../../../context/SessionRoutingContext')
vi.mock('../../../context/WorkspaceContext')

function session(id, parentId = null, isSideThread = false) {
  return { session_id: id, parent_session_id: parentId, is_side_thread: isSideThread }
}

const navigateToSession = vi.fn()

function mockContext({ sessions, activeSessionId }) {
  vi.mocked(useSessionsList).mockReturnValue({ sessions })
  vi.mocked(useSessionRouting).mockReturnValue({ activeSessionId, navigateToSession })
  vi.mocked(useWorkspace).mockReturnValue({ workspaceId: 'ws-1' })
}

describe('useSessionRail', () => {
  beforeEach(() => {
    sessionStorage.clear()
    navigateToSession.mockClear()
  })

  it('a session with no children renders one focused group and no navigation', () => {
    mockContext({ sessions: [session('root')], activeSessionId: 'root' })

    const { result } = renderHook(() => useSessionRail())

    expect(result.current.renderedGroups).toEqual([
      { sessionId: 'root', isFocused: true, isRoot: true },
    ])
    expect(result.current.focusPrev).toBeNull()
    expect(result.current.focusNext).toBeNull()
  })

  it('renders ancestors left of the focused group in ancestry order', () => {
    const sessions = [session('root'), session('mid', 'root', true), session('leaf', 'mid', true)]
    mockContext({ sessions, activeSessionId: 'leaf' })

    const { result } = renderHook(() => useSessionRail())

    expect(result.current.renderedGroups.map(g => g.sessionId)).toEqual(['root', 'mid', 'leaf'])
    expect(result.current.renderedGroups.at(-1)).toMatchObject({
      sessionId: 'leaf',
      isFocused: true,
    })
  })

  it('exposes the full uncapped chain separately from the rendered (capped) groups', () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      session(`s${i}`, i === 0 ? null : `s${i - 1}`, i !== 0),
    )
    mockContext({ sessions, activeSessionId: 's7' })

    const { result } = renderHook(() => useSessionRail())

    expect(result.current.chain).toHaveLength(8)
    expect(result.current.renderedGroups.length).toBeLessThan(8)
  })

  it('focusPrev navigates to the immediately preceding rendered group', () => {
    const sessions = [session('root'), session('mid', 'root', true), session('leaf', 'mid', true)]
    mockContext({ sessions, activeSessionId: 'leaf' })

    const { result } = renderHook(() => useSessionRail())
    result.current.focusPrev()

    expect(navigateToSession).toHaveBeenCalledWith('ws-1', 'mid')
  })

  it('focusNext navigates to the immediately following rendered group (the walked-back tail)', () => {
    const sessions = [session('root'), session('child', 'root', true)]
    mockContext({ sessions, activeSessionId: 'child' })

    // First visit establishes the tail: root -> child.
    renderHook(() => useSessionRail())

    // Walk back to root - 'child' becomes the tail, rendered to the right of focus.
    mockContext({ sessions, activeSessionId: 'root' })
    const { result } = renderHook(() => useSessionRail())

    expect(result.current.renderedGroups.map(g => g.sessionId)).toEqual(['root', 'child'])
    result.current.focusNext()

    expect(navigateToSession).toHaveBeenCalledWith('ws-1', 'child')
  })

  it('clamps at the left end - focusPrev is null on the root/only group', () => {
    mockContext({ sessions: [session('root')], activeSessionId: 'root' })

    const { result } = renderHook(() => useSessionRail())

    expect(result.current.focusPrev).toBeNull()
  })

  it('clamps at the right end - focusNext is null with no walked-back tail', () => {
    const sessions = [session('root'), session('leaf', 'root', true)]
    mockContext({ sessions, activeSessionId: 'leaf' })

    const { result } = renderHook(() => useSessionRail())

    expect(result.current.focusNext).toBeNull()
  })

  it('renders no groups and no focused session when routing names none yet', () => {
    mockContext({ sessions: [], activeSessionId: null })

    const { result } = renderHook(() => useSessionRail())

    expect(result.current.renderedGroups).toEqual([])
    expect(result.current.focusedSessionId).toBeNull()
  })
})
