/** Tests for MainPanel - URL-driven content selection (welcome | chat | board). */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

let mockActiveSessionId = null
let mockActiveBoardId = null
let mockActiveWorkspaceId = null
let mockWorkspaceId = 'ws'

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({
    activeSessionId: mockActiveSessionId,
    activeBoardId: mockActiveBoardId,
    activeWorkspaceId: mockActiveWorkspaceId,
  }),
}))

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: mockWorkspaceId }),
}))

vi.mock('./SessionHeaderStrip', () => ({
  default: () => <div data-testid="session-header-strip">strip</div>,
}))

vi.mock('../../chat', () => ({
  default: () => <div data-testid="panel-chat">chat</div>,
}))

vi.mock('../../boards/BoardTab', () => ({
  default: ({ boardId }) => <div data-testid="board-tab" data-board-id={boardId} />,
}))

import MainPanel from './MainPanel'

describe('MainPanel', () => {
  beforeEach(() => {
    mockActiveSessionId = null
    mockActiveBoardId = null
    mockActiveWorkspaceId = null
    mockWorkspaceId = 'ws'
  })

  it('renders ChatPanel and welcome mode when no session and no board', () => {
    render(<MainPanel />)

    expect(screen.getByTestId('panel-chat')).toBeInTheDocument()
    expect(screen.queryByTestId('board-tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('main-panel-content')).toHaveAttribute('data-mode', 'welcome')
  })

  it('renders ChatPanel and chat mode when a session is active', () => {
    mockActiveSessionId = 'sess-1'
    render(<MainPanel />)

    expect(screen.getByTestId('panel-chat')).toBeInTheDocument()
    expect(screen.queryByTestId('board-tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('main-panel-content')).toHaveAttribute('data-mode', 'chat')
  })

  it('renders BoardTab and board mode when a board id is active (board precedes session)', () => {
    mockActiveSessionId = 'sess-1'
    mockActiveBoardId = 'b1'
    render(<MainPanel />)

    expect(screen.queryByTestId('panel-chat')).not.toBeInTheDocument()
    expect(screen.getByTestId('board-tab')).toHaveAttribute('data-board-id', 'b1')
    expect(screen.getByTestId('main-panel-content')).toHaveAttribute('data-mode', 'board')
  })

  it('passes the active board id to BoardTab as a prop', () => {
    mockActiveBoardId = 'sprint-board'
    render(<MainPanel />)

    expect(screen.getByTestId('board-tab')).toHaveAttribute('data-board-id', 'sprint-board')
  })

  it('defers BoardTab mount until workspace matches the URL', () => {
    mockActiveBoardId = 'b1'
    mockActiveWorkspaceId = 'ws-A'
    mockWorkspaceId = 'ws-B'

    render(<MainPanel />)

    expect(screen.queryByTestId('board-tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('panel-chat')).toBeInTheDocument()
  })

  it('always renders the SessionHeaderStrip regardless of mode', () => {
    mockActiveBoardId = 'b1'
    const { rerender } = render(<MainPanel />)
    expect(screen.getByTestId('session-header-strip')).toBeInTheDocument()

    mockActiveBoardId = null
    mockActiveSessionId = 'sess-1'
    rerender(<MainPanel />)
    expect(screen.getByTestId('session-header-strip')).toBeInTheDocument()

    mockActiveSessionId = null
    rerender(<MainPanel />)
    expect(screen.getByTestId('session-header-strip')).toBeInTheDocument()
  })

  it('exposes data-testid="main-panel" on the root', () => {
    render(<MainPanel />)
    expect(screen.getByTestId('main-panel')).toBeInTheDocument()
  })
})
