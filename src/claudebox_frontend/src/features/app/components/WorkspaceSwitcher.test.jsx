/** Tests for WorkspaceSwitcher component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceSwitcher from './WorkspaceSwitcher'

vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="icon-check">✓</span>,
  ChevronDown: () => <span data-testid="icon-chevron">▼</span>,
  ExternalLink: () => <span data-testid="icon-external-link">↗</span>,
  Plus: () => <span data-testid="icon-plus">+</span>,
  Trash2: () => <span data-testid="icon-trash">🗑</span>,
}))

vi.mock('../../../utils/navigation', () => ({
  openWorkspaceInNewTab: vi.fn(),
}))

// Mock api/workspaces — WorkspaceSwitcher imports deregisterWorkspace.
// Also a no-op for registerWorkspace via RegisterWorkspaceModal.
const mockDeregisterWorkspace = vi.fn(() => Promise.resolve({ id: 'project-a' }))
const mockRegisterWorkspace = vi.fn(() => Promise.resolve({ id: 'project-c', path: '/x' }))
vi.mock('../../../api/workspaces', () => ({
  deregisterWorkspace: (...args) => mockDeregisterWorkspace(...args),
  registerWorkspace: (...args) => mockRegisterWorkspace(...args),
}))

const mockWorkspaceCtx = {
  workspaces: [],
  workspaceId: null,
  selectWorkspace: vi.fn(),
  refreshWorkspaces: vi.fn(() => Promise.resolve([])),
}

vi.mock('../../../context/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspaceCtx,
}))

const mockNavigateToWorkspace = vi.fn()

vi.mock('../../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ navigateToWorkspace: mockNavigateToWorkspace }),
}))

const mockSessionsCtx = {
  workspaceColor: null,
  setWorkspaceColor: vi.fn(),
}

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => mockSessionsCtx,
}))

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({ sessionId: null, sessionName: null }),
}))

vi.mock('../../../context/StillRunningToastContext', () => ({
  useStillRunningToast: () => ({
    toast: null,
    showStillRunningToast: vi.fn(),
    dismissStillRunningToast: vi.fn(),
  }),
}))

vi.mock('../../../context/EventsContext', () => ({
  useEvents: () => ({
    startOpeningWorkspace: vi.fn(),
    clearOpeningWorkspace: vi.fn(),
  }),
}))

describe('WorkspaceSwitcher', () => {
  const chatPanels = [{ id: 'chat' }, { id: 'file:/tmp/test.js' }]
  const twoWorkspaces = [
    { id: 'project-a', path: '/home/user/project-a' },
    { id: 'project-b', path: '/home/user/project-b' },
  ]

  beforeEach(() => {
    mockWorkspaceCtx.workspaces = []
    mockWorkspaceCtx.workspaceId = null
    mockWorkspaceCtx.selectWorkspace.mockReset()
    mockNavigateToWorkspace.mockReset()
    mockSessionsCtx.workspaceColor = null
    mockSessionsCtx.setWorkspaceColor.mockReset()
  })

  it('renders switcher button for single workspace in chat group', () => {
    mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
    mockWorkspaceCtx.workspaceId = 'solo'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    expect(screen.getByTestId('workspace-switcher')).toBeInTheDocument()
  })

  it('renders switcher button with current workspace name', () => {
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    const btn = screen.getByTestId('workspace-switcher')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('project-a')
  })

  it('opens dropdown on click', async () => {
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    expect(screen.queryByTestId('workspace-switcher-dropdown')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('workspace-switcher'))

    const dropdown = screen.getByTestId('workspace-switcher-dropdown')
    expect(dropdown).toBeInTheDocument()
    expect(dropdown).toHaveTextContent('project-a')
    expect(dropdown).toHaveTextContent('project-b')
  })

  it('shows check icon next to selected workspace', async () => {
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    await user.click(screen.getByTestId('workspace-switcher'))

    const checks = screen.getAllByTestId('icon-check')
    expect(checks).toHaveLength(1)
  })

  it('shows workspace paths in dropdown', async () => {
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    await user.click(screen.getByTestId('workspace-switcher'))

    expect(screen.getByText('/home/user/project-a')).toBeInTheDocument()
    expect(screen.getByText('/home/user/project-b')).toBeInTheDocument()
  })

  it('calls selectWorkspace on selection', async () => {
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    await user.click(screen.getByTestId('workspace-switcher'))
    await user.click(screen.getByText('project-b'))

    expect(mockWorkspaceCtx.selectWorkspace).toHaveBeenCalledWith('project-b')
  })

  it('does not call selectWorkspace when selecting current workspace', async () => {
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    await user.click(screen.getByTestId('workspace-switcher'))
    const dropdown = screen.getByTestId('workspace-switcher-dropdown')
    const currentOption = dropdown.querySelector('.workspace-switcher-option.selected')
    await user.click(currentOption)

    expect(mockWorkspaceCtx.selectWorkspace).not.toHaveBeenCalled()
  })

  it('closes dropdown after selection', async () => {
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    await user.click(screen.getByTestId('workspace-switcher'))
    expect(screen.getByTestId('workspace-switcher-dropdown')).toBeInTheDocument()

    await user.click(screen.getByText('project-b'))
    expect(screen.queryByTestId('workspace-switcher-dropdown')).not.toBeInTheDocument()
  })

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    await user.click(screen.getByTestId('workspace-switcher'))
    expect(screen.getByTestId('workspace-switcher-dropdown')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('workspace-switcher-dropdown')).not.toBeInTheDocument()
  })

  it('middle-click on workspace opens it in new browser tab', async () => {
    const { openWorkspaceInNewTab } = await import('../../../utils/navigation')
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    await user.click(screen.getByTestId('workspace-switcher'))

    const options = screen
      .getByTestId('workspace-switcher-dropdown')
      .querySelectorAll('.workspace-switcher-option')
    options[1].dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))

    expect(openWorkspaceInNewTab).toHaveBeenCalledWith('project-b')
  })

  it('Alt+Click on workspace opens it in new browser tab', async () => {
    const { openWorkspaceInNewTab } = await import('../../../utils/navigation')
    const user = userEvent.setup()
    mockWorkspaceCtx.workspaces = twoWorkspaces
    mockWorkspaceCtx.workspaceId = 'project-a'

    render(<WorkspaceSwitcher panels={chatPanels} />)

    await user.click(screen.getByTestId('workspace-switcher'))

    const options = screen
      .getByTestId('workspace-switcher-dropdown')
      .querySelectorAll('.workspace-switcher-option')
    options[1].dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }))

    expect(openWorkspaceInNewTab).toHaveBeenCalledWith('project-b')
    expect(mockWorkspaceCtx.selectWorkspace).not.toHaveBeenCalled()
  })

  describe('color palette', () => {
    it('shows color palette in dropdown for single workspace', async () => {
      const user = userEvent.setup()
      mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
      mockWorkspaceCtx.workspaceId = 'solo'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      await user.click(screen.getByTestId('workspace-switcher'))

      expect(screen.getByTestId('workspace-color-palette')).toBeInTheDocument()
    })

    it('does not show workspace list for single workspace', async () => {
      const user = userEvent.setup()
      mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
      mockWorkspaceCtx.workspaceId = 'solo'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      await user.click(screen.getByTestId('workspace-switcher'))

      const dropdown = screen.getByTestId('workspace-switcher-dropdown')
      // The workspace list section is hidden when only one workspace exists.
      expect(dropdown.querySelector('.workspace-switcher-option')).not.toBeInTheDocument()
      // The register-footer divider is still rendered — it separates the color
      // palette from the "+ Register workspace…" item and is independent of the
      // workspace-list visibility.
      expect(dropdown.querySelectorAll('.workspace-switcher-divider')).toHaveLength(1)
    })

    it('shows workspace list and palette for multiple workspaces', async () => {
      const user = userEvent.setup()
      mockWorkspaceCtx.workspaces = twoWorkspaces
      mockWorkspaceCtx.workspaceId = 'project-a'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      await user.click(screen.getByTestId('workspace-switcher'))

      const dropdown = screen.getByTestId('workspace-switcher-dropdown')
      expect(dropdown.querySelector('.workspace-switcher-divider')).toBeInTheDocument()
      expect(screen.getByTestId('workspace-color-palette')).toBeInTheDocument()
    })

    it('calls setWorkspaceColor when clicking a swatch', async () => {
      const user = userEvent.setup()
      mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
      mockWorkspaceCtx.workspaceId = 'solo'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      await user.click(screen.getByTestId('workspace-switcher'))

      const swatches = screen
        .getByTestId('workspace-color-palette')
        .querySelectorAll('.workspace-color-swatch')
      await user.click(swatches[0])

      expect(mockSessionsCtx.setWorkspaceColor).toHaveBeenCalled()
    })

    it('toggles color off when clicking active swatch', async () => {
      const user = userEvent.setup()
      mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
      mockWorkspaceCtx.workspaceId = 'solo'
      mockSessionsCtx.workspaceColor = '#1e3a5f'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      await user.click(screen.getByTestId('workspace-switcher'))

      const activeSwatch = screen
        .getByTestId('workspace-color-palette')
        .querySelector('.workspace-color-swatch.active')
      await user.click(activeSwatch)

      expect(mockSessionsCtx.setWorkspaceColor).toHaveBeenCalledWith(null)
    })

    it('shows clear button when color is active', async () => {
      const user = userEvent.setup()
      mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
      mockWorkspaceCtx.workspaceId = 'solo'
      mockSessionsCtx.workspaceColor = '#1e3a5f'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      await user.click(screen.getByTestId('workspace-switcher'))

      const clearBtn = screen
        .getByTestId('workspace-color-palette')
        .querySelector('.workspace-color-clear')
      expect(clearBtn).toBeInTheDocument()
    })

    it('does not show clear button when no color is active', async () => {
      const user = userEvent.setup()
      mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
      mockWorkspaceCtx.workspaceId = 'solo'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      await user.click(screen.getByTestId('workspace-switcher'))

      const clearBtn = screen
        .getByTestId('workspace-color-palette')
        .querySelector('.workspace-color-clear')
      expect(clearBtn).not.toBeInTheDocument()
    })

    it('shows colored dot in button when color is set', () => {
      mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
      mockWorkspaceCtx.workspaceId = 'solo'
      mockSessionsCtx.workspaceColor = '#1e3a5f'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      const dot = screen.getByTestId('workspace-switcher').querySelector('.workspace-switcher-dot')
      expect(dot).toBeInTheDocument()
    })

    it('does not show colored dot when no color is set', () => {
      mockWorkspaceCtx.workspaces = [{ id: 'solo', path: '/home/user/solo' }]
      mockWorkspaceCtx.workspaceId = 'solo'

      render(<WorkspaceSwitcher panels={chatPanels} />)

      const dot = screen.getByTestId('workspace-switcher').querySelector('.workspace-switcher-dot')
      expect(dot).not.toBeInTheDocument()
    })
  })
})
