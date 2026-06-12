/** Tests for WelcomeContent component. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WelcomeContent from './WelcomeContent'

const mockWorkspaceCtx = {
  workspaceId: 'my-project',
  workspaces: [{ id: 'my-project', path: '/home/user/my-project' }],
}

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspaceCtx,
}))

const mockSessionsCtx = {
  workspaceColor: null,
}

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => mockSessionsCtx,
}))

let mockIsMobile = false
vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => mockIsMobile,
}))

describe('WelcomeContent', () => {
  beforeEach(() => {
    mockWorkspaceCtx.workspaceId = 'my-project'
    mockWorkspaceCtx.workspaces = [{ id: 'my-project', path: '/home/user/my-project' }]
    mockSessionsCtx.workspaceColor = null
    mockIsMobile = false
  })

  it('renders welcome content with workspace name and path', () => {
    render(<WelcomeContent />)

    expect(screen.getByTestId('welcome-page')).toBeInTheDocument()
    expect(screen.getByText('my-project')).toBeInTheDocument()
    expect(screen.getByText('/home/user/my-project')).toBeInTheDocument()
  })

  it('shows keyboard shortcuts reference', () => {
    render(<WelcomeContent />)

    const shortcuts = screen.getByTestId('welcome-shortcuts')
    expect(shortcuts).toBeInTheDocument()
    expect(shortcuts).toHaveTextContent('Alt+1')
    expect(shortcuts).toHaveTextContent('Sessions')
    expect(shortcuts).toHaveTextContent('Alt+C')
    expect(shortcuts).toHaveTextContent('Focus Chat')
    expect(shortcuts).toHaveTextContent('Alt+?')
    expect(shortcuts).toHaveTextContent('Help')
  })

  it('applies workspace accent color to name when set', () => {
    mockSessionsCtx.workspaceColor = '#1a2332'

    render(<WelcomeContent />)

    const name = screen.getByText('my-project')
    expect(name).toHaveStyle({ color: '#1a2332' })
  })

  it('uses default color for name when no accent color', () => {
    render(<WelcomeContent />)

    const name = screen.getByText('my-project')
    expect(name).not.toHaveAttribute('style')
  })

  it('shows fallback dash when no workspace ID', () => {
    mockWorkspaceCtx.workspaceId = null
    mockWorkspaceCtx.workspaces = []

    render(<WelcomeContent />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('does not render path when workspace not found', () => {
    mockWorkspaceCtx.workspaceId = 'unknown'
    mockWorkspaceCtx.workspaces = []

    const { container } = render(<WelcomeContent />)

    expect(container.querySelector('.welcome-path')).not.toBeInTheDocument()
  })

  it('hides keyboard shortcuts reference on mobile', () => {
    mockIsMobile = true

    render(<WelcomeContent />)

    expect(screen.queryByTestId('welcome-shortcuts')).not.toBeInTheDocument()
  })
})
