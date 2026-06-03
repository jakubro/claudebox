/** Tests for App root component. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// --- Mock useIsMobile to always return desktop ---

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => false,
}))

// --- Mutable mocks ---

let capturedOnReady = null

// --- Mock DockviewReact (heavy external library) ---

vi.mock('dockview-react', () => ({
  DockviewReact: ({ onReady, className }) => {
    capturedOnReady = onReady
    return <div data-testid="mock-dockview" className={className} />
  },
}))

// --- Mock providers (network boundaries) ---

vi.mock('../../context/DaemonStreamContext', () => ({
  DaemonStreamProvider: ({ children }) => <>{children}</>,
  useDaemonStreamContext: () => ({ progressMessage: null, sessionsChanged: 0, containerStatus: 0 }),
}))

vi.mock('../../context/SessionsContext', () => ({
  SessionsProvider: ({ children }) => <>{children}</>,
  useSessionsList: () => ({ sessions: [] }),
}))

vi.mock('../../context/AppActionsContext', () => ({
  AppActionsProvider: ({ children }) => <>{children}</>,
  useAppActions: () => ({}),
}))

vi.mock('../../context/EventsContext', () => ({
  EventsProvider: ({ children }) => <>{children}</>,
  useEvents: () => ({
    reconnectSSE: vi.fn(),
    disconnectSSE: vi.fn(),
    closeSSE: vi.fn(),
    containerId: null,
    isConnected: false,
  }),
}))

vi.mock('../../context/SessionDataContext', () => ({
  SessionDataProvider: ({ children }) => <>{children}</>,
  useSessionData: () => ({ sessionId: null, sessionName: null }),
  useSessionActions: () => ({ clearSessionData: vi.fn() }),
  useSessionId: () => null,
}))

vi.mock('./components/SessionHeaderStrip', () => ({
  default: () => <div data-testid="mock-session-header-strip" />,
}))

vi.mock('./components/StillRunningToast', () => ({
  default: () => <div data-testid="mock-still-running-toast" />,
}))

vi.mock('../../context/StillRunningToastContext', () => ({
  StillRunningToastProvider: ({ children }) => <>{children}</>,
  useStillRunningToast: () => ({
    toast: null,
    showStillRunningToast: vi.fn(),
    dismissStillRunningToast: vi.fn(),
  }),
}))

vi.mock('../../context/InteractionContext', () => ({
  InteractionProvider: ({ children }) => <>{children}</>,
  useInteraction: () => ({ setError: vi.fn() }),
}))

vi.mock('../../context/BookmarksContext', () => ({
  BookmarksProvider: ({ children }) => <>{children}</>,
}))

vi.mock('../../context/LogsStreamContext', () => ({
  LogsStreamProvider: ({ children }) => <>{children}</>,
}))

vi.mock('../../context/BottomPanelsContext', () => ({
  BottomPanelsProvider: ({ children }) => <>{children}</>,
  useBottomPanels: () => ({
    openSet: new Set(),
    height: 240,
    panelSideMap: new Map(),
    registerBottomPanel: vi.fn(),
    unregisterBottomPanel: vi.fn(),
    isBottomPanelId: () => false,
    togglePanel: vi.fn(),
    closePanel: vi.fn(),
    setHeight: vi.fn(),
  }),
}))

vi.mock('../../context/StashContext', () => ({
  StashProvider: ({ children }) => <>{children}</>,
  useStash: () => ({ clearStash: vi.fn() }),
}))

vi.mock('../../context/WorkspaceContext', () => ({
  WorkspaceProvider: ({ children }) => <>{children}</>,
  useWorkspace: () => ({ workspaceId: null, workspaces: [], selectWorkspace: vi.fn() }),
}))

vi.mock('../../hooks/useNewSession', () => ({
  default: () => ({ executeNewSession: vi.fn(), isCreating: false }),
}))

vi.mock('../../api/sessions', () => ({
  newSession: vi.fn(),
}))

vi.mock('../../utils/navigation', () => ({
  openSessionInNewTab: vi.fn(),
}))

// --- Mock child components ---

let capturedIconStripProps = []

vi.mock('../icon-strip', () => ({
  default: props => {
    capturedIconStripProps.push(props)
    return <div data-testid={`mock-icon-strip-${props.position}`}>{props.panels.join(',')}</div>
  },
}))

vi.mock('../footer', () => ({
  default: () => <div data-testid="mock-footer" />,
}))

vi.mock('./components/IconTab', () => ({
  default: () => <div data-testid="mock-icon-tab" />,
}))

vi.mock('../chat', () => ({ default: () => <div data-testid="mock-chat-panel" /> }))
vi.mock('../todos/TodosPanel', () => ({
  default: () => <div data-testid="mock-todos-panel" />,
}))
vi.mock('../stash/StashPanel', () => ({
  default: () => <div data-testid="mock-stash-panel" />,
}))
vi.mock('../mcp/McpPanel', () => ({ default: () => <div data-testid="mock-mcp-panel" /> }))
vi.mock('../tasks', () => ({ default: () => <div data-testid="mock-tasks-panel" /> }))
vi.mock('../sessions', () => ({
  default: () => <div data-testid="mock-sessions-panel" />,
}))
vi.mock('../help/HelpPanel', () => ({
  default: () => <div data-testid="mock-help-panel" />,
}))
vi.mock('../usage/UsagePanel', () => ({
  default: () => <div data-testid="mock-usage-panel" />,
}))
vi.mock('../logs/LogsPanel', () => ({
  default: () => <div data-testid="mock-logs-panel" />,
}))

vi.mock('../../managers/SidePanelManager', () => ({
  default: class MockSidePanelManager {
    constructor() {
      this.state = { left: { order: [] }, right: { order: [] }, bottom: { order: [] } }
      this.toggle = vi.fn()
      this.close = vi.fn()
      this.fromJSON = vi.fn()
      this.handlePanelMove = vi.fn()
      this.updateDimensions = vi.fn()
      this.toJSON = vi.fn(() => ({}))
      this.preMaximizeLayout = null
      this.maximizeToggle = vi.fn()
      this.restoreFromServer = vi.fn().mockResolvedValue({ loaded: false })
    }
  },
}))

vi.mock('../../api/uiState', () => ({
  patchSessionUiState: vi.fn(),
}))

describe('App', () => {
  beforeEach(() => {
    capturedOnReady = null
    capturedIconStripProps = []
  })

  it('renders the app container with dockview', () => {
    render(<App />)

    expect(screen.getByTestId('mock-dockview')).toBeInTheDocument()
    expect(screen.getByTestId('mock-footer')).toBeInTheDocument()
  })

  describe('icon strips', () => {
    it('renders left icon strip with the sessions panel only', () => {
      render(<App />)

      const leftStrip = screen.getByTestId('mock-icon-strip-left')
      expect(leftStrip).toBeInTheDocument()
      expect(leftStrip.textContent).toContain('sessions')
      expect(leftStrip.textContent).not.toContain('bookmarks')
      expect(leftStrip.textContent).not.toContain('boards')
    })

    it('renders right icon strip with todos, stash, tasks, bookmarks, boards, usage, mcp, commands, help panels', () => {
      render(<App />)

      const rightStrip = screen.getByTestId('mock-icon-strip-right')
      expect(rightStrip).toBeInTheDocument()
      expect(rightStrip.textContent).toContain('todos')
      expect(rightStrip.textContent).toContain('stash')
      expect(rightStrip.textContent).toContain('tasks')
      expect(rightStrip.textContent).toContain('bookmarks')
      expect(rightStrip.textContent).toContain('boards')
      expect(rightStrip.textContent).toContain('usage')
      expect(rightStrip.textContent).toContain('mcp')
      expect(rightStrip.textContent).toContain('commands')
      expect(rightStrip.textContent).toContain('help')
    })
  })

  describe('dockview configuration', () => {
    it('passes dark theme class to DockviewReact', () => {
      render(<App />)

      const dockview = screen.getByTestId('mock-dockview')
      expect(dockview.className).toContain('dockview-theme-dark')
    })

    it('passes onReady callback to DockviewReact', () => {
      render(<App />)

      expect(capturedOnReady).toBeInstanceOf(Function)
    })
  })
})
