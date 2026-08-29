/** Tests for SessionRail - group composition and rail-focus navigation registration. */

import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useSessionRail from '../hooks/useSessionRail'
import SessionRail from './SessionRail'

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../hooks/useSessionRail')

const mockRailPrevRef = { current: null }
const mockRailNextRef = { current: null }

vi.mock('../../../context/AppActionsContext', () => ({
  useAppActions: () => ({ railPrevRef: mockRailPrevRef, railNextRef: mockRailNextRef }),
}))

// Tracks mount/unmount cycles so a test can prove the focused ChatPanel's identity survives a
// groups transition, rather than merely asserting the DOM it renders on either side of it.
let chatPanelMounts = 0
vi.mock('../ChatPanel', () => ({
  default: () => {
    useEffect(() => {
      chatPanelMounts += 1
    }, [])
    return <div data-testid="panel-chat">focused</div>
  },
}))

vi.mock('./AncestorGroup', () => ({
  default: ({ sessionId }) => <div data-testid="rail-ancestor" data-session-id={sessionId} />,
}))

function railState({ groups, focusedSessionId = null, focusPrev = null, focusNext = null }) {
  return { renderedGroups: groups, focusedSessionId, focusPrev, focusNext }
}

describe('SessionRail', () => {
  beforeEach(() => {
    mockRailPrevRef.current = null
    mockRailNextRef.current = null
    chatPanelMounts = 0
  })

  it('renders the focused ChatPanel in the rail wrapper with no ancestors when there is no session yet (welcome/creating)', () => {
    vi.mocked(useSessionRail).mockReturnValue(railState({ groups: [] }))

    render(<SessionRail />)

    expect(screen.getByTestId('panel-chat')).toBeInTheDocument()
    expect(screen.getByTestId('chat-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('rail-ancestor')).not.toBeInTheDocument()
  })

  it('never remounts ChatPanel when groups goes from empty to populated - the focused slot is a fixed position, not keyed by session id', () => {
    vi.mocked(useSessionRail).mockReturnValue(railState({ groups: [] }))
    const { rerender } = render(<SessionRail />)
    expect(chatPanelMounts).toBe(1)

    // Mirrors welcome -> creating -> live: activeSessionId goes from unset to a real (if not yet
    // registered) session id, and renderedGroups follows it from empty to one focused entry.
    vi.mocked(useSessionRail).mockReturnValue(
      railState({
        groups: [{ sessionId: 'new-session', isFocused: true, isRoot: true }],
        focusedSessionId: 'new-session',
      }),
    )
    rerender(<SessionRail />)

    expect(chatPanelMounts).toBe(1)
    expect(screen.getByTestId('panel-chat')).toBeInTheDocument()
  })

  it('a rail of one renders exactly one live ChatPanel and no ancestors', () => {
    vi.mocked(useSessionRail).mockReturnValue(
      railState({
        groups: [{ sessionId: 'sess-1', isFocused: true, isRoot: true }],
        focusedSessionId: 'sess-1',
      }),
    )

    render(<SessionRail />)

    expect(screen.getAllByTestId('panel-chat')).toHaveLength(1)
    expect(screen.queryByTestId('rail-ancestor')).not.toBeInTheDocument()
  })

  it('renders one AncestorGroup per non-focused entry, in rail order, and exactly one ChatPanel', () => {
    vi.mocked(useSessionRail).mockReturnValue(
      railState({
        groups: [
          { sessionId: 'root', isFocused: false, isRoot: true },
          { sessionId: 'mid', isFocused: false, isRoot: false },
          { sessionId: 'leaf', isFocused: true, isRoot: false },
        ],
        focusedSessionId: 'leaf',
      }),
    )

    render(<SessionRail />)

    const ancestors = screen.getAllByTestId('rail-ancestor')
    expect(ancestors.map(el => el.dataset.sessionId)).toEqual(['root', 'mid'])
    expect(screen.getAllByTestId('panel-chat')).toHaveLength(1)
  })

  it('registers focusPrev/focusNext into the rail navigation refs, and clears them on unmount', () => {
    const focusPrev = vi.fn()
    const focusNext = vi.fn()
    vi.mocked(useSessionRail).mockReturnValue(
      railState({
        groups: [{ sessionId: 'sess-1', isFocused: true, isRoot: true }],
        focusedSessionId: 'sess-1',
        focusPrev,
        focusNext,
      }),
    )

    const { unmount } = render(<SessionRail />)

    expect(mockRailPrevRef.current).toBe(focusPrev)
    expect(mockRailNextRef.current).toBe(focusNext)

    unmount()

    expect(mockRailPrevRef.current).toBeNull()
    expect(mockRailNextRef.current).toBeNull()
  })

  it('leaves the rail navigation refs null when the rail has only one group', () => {
    vi.mocked(useSessionRail).mockReturnValue(
      railState({
        groups: [{ sessionId: 'sess-1', isFocused: true, isRoot: true }],
        focusedSessionId: 'sess-1',
        focusPrev: null,
        focusNext: null,
      }),
    )

    render(<SessionRail />)

    expect(mockRailPrevRef.current).toBeNull()
    expect(mockRailNextRef.current).toBeNull()
  })
})
