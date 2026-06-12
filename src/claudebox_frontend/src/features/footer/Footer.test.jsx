/** Tests for Footer component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Footer from './Footer'

// Real formatDurationClock - pure function, no side effects

// Default data factories for each context
function defaultEventsData(overrides = {}) {
  return {
    connectionStatus: 'connected',
    connectionError: null,
    isResponding: false,
    respondingSince: null,
    lastEventTimestamp: null,
    isResuming: false,
    isReplaying: false,
    ...overrides,
  }
}

const mockSetNotificationsEnabled = vi.fn()

function defaultSessionDataCtx(overrides = {}) {
  return {
    model: 'claude-3-opus',
    permissionMode: null,
    workspace: '/home/user/project',
    numTurns: 5,
    totalCostUsd: 0.25,
    totalDurationMs: 120000,
    lastContextTokens: 50000,
    contextWindow: 200000,
    effortLevel: 'medium',
    sessionId: 'abc123',
    sessionDir: '/tmp/sessions/abc123',
    notificationsEnabled: false,
    availableEffortLevels: [
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
      { id: 'max', name: 'Max' },
    ],
    ...overrides,
  }
}

function defaultInteractionData(overrides = {}) {
  return {
    isSubmitting: false,
    isAwaitingResponse: false,
    interruptStatus: null,
    errorMessage: null,
    ...overrides,
  }
}

let mockEventsData, mockSessionDataCtx, mockInteractionData

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => mockEventsData,
}))
vi.mock('../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionDataCtx,
  useSessionActions: () => ({ setNotificationsEnabled: mockSetNotificationsEnabled }),
}))
vi.mock('../../context/InteractionContext', () => ({
  useInteraction: () => mockInteractionData,
}))

// Footer's useCurrentBackendId hook touches WorkspaceContext and
// DaemonStreamContext. Mock both so Footer can mount.
// WorkspaceContext export is also consumed directly by useSessionDefaults
// via useContext(WorkspaceContext) - re-export the createContext object so
// the import resolves.
vi.mock('../../context/WorkspaceContext', async () => {
  const { createContext } = await import('react')
  return {
    WorkspaceContext: createContext(null),
    useWorkspace: () => ({ workspaceId: null }),
  }
})
vi.mock('../../context/DaemonStreamContext', () => ({
  useDaemonStreamContext: () => ({ lastContainerEvent: null }),
}))

vi.mock('./components/ModelPicker', () => ({
  default: ({ currentModel, disabled }) => (
    <span data-testid="footer-model" data-disabled={disabled}>
      {currentModel || '-'}
    </span>
  ),
}))

vi.mock('./components/PermissionModePicker', () => ({
  default: ({ currentPermissionMode, disabled }) => (
    <span data-testid="footer-permission-mode-picker" data-disabled={disabled}>
      {currentPermissionMode || '-'}
    </span>
  ),
}))

vi.mock('./components/EffortLevelPicker', () => ({
  default: ({ currentEffortLevel, disabled }) => (
    <span data-testid="footer-effort" data-disabled={disabled}>
      {currentEffortLevel || '-'}
    </span>
  ),
}))

vi.mock('./hooks/useClaudeStatus', () => ({
  default: () => ({
    indicator: 'none',
    description: 'All Systems Operational',
    isLoading: false,
    error: false,
  }),
}))

beforeEach(() => {
  mockEventsData = defaultEventsData()
  mockSessionDataCtx = defaultSessionDataCtx()
  mockInteractionData = defaultInteractionData()
  mockSetNotificationsEnabled.mockReset()
})

describe('StatusIndicator', () => {
  it('shows Ready when connected and idle', () => {
    render(<Footer />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('shows Working... when responding', () => {
    mockEventsData = defaultEventsData({ isResponding: true })
    render(<Footer />)
    expect(screen.getByText('Working')).toBeInTheDocument()
  })

  it('shows Stopping... when interruptStatus="stopping"', () => {
    mockInteractionData = defaultInteractionData({ interruptStatus: 'stopping' })
    render(<Footer />)
    expect(screen.getByText('Stopping')).toBeInTheDocument()
  })

  it('shows error message when errorMessage present', () => {
    mockInteractionData = defaultInteractionData({ errorMessage: 'Request failed' })
    render(<Footer />)
    expect(screen.getByText('Request failed')).toBeInTheDocument()
  })

  it('shows connection status when not connected', () => {
    mockEventsData = defaultEventsData({ connectionStatus: 'disconnected' })
    render(<Footer />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })
})

describe('Footer', () => {
  it('shows DEV indicator in development mode', () => {
    render(<Footer />)
    expect(screen.getByText('DEV')).toBeInTheDocument()
  })

  it('displays workspace name', () => {
    render(<Footer />)
    expect(screen.getByText('project')).toBeInTheDocument()
  })

  it('displays workspace name before session initialization', () => {
    mockSessionDataCtx = defaultSessionDataCtx({ sessionId: null, sessionDir: null })
    render(<Footer />)
    expect(screen.getByText('project')).toBeInTheDocument()
  })

  it('displays turns, cost, duration', () => {
    render(<Footer />)
    expect(screen.getByText('5 turns')).toBeInTheDocument()
    expect(screen.getByText('$0.25')).toBeInTheDocument()
    expect(screen.getByText('0:02:00')).toBeInTheDocument()
  })

  it('displays context percentage bar', () => {
    render(<Footer />)
    // 50000/200000 = 25%
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('adjusts context percentage for larger context window', () => {
    mockSessionDataCtx = defaultSessionDataCtx({ contextWindow: 1000000 })
    // 50000/1000000 = 5%
    render(<Footer />)
    expect(screen.getByText('5%')).toBeInTheDocument()
  })

  it('displays model and session ID', () => {
    render(<Footer />)
    expect(screen.getByText('claude-3-opus')).toBeInTheDocument()
    expect(screen.getByText('abc123')).toBeInTheDocument()
  })

  it('copies session path on session click', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })

    render(<Footer />)
    await user.click(screen.getByTestId('footer-session'))

    expect(writeText).toHaveBeenCalledWith('/tmp/sessions/abc123')
  })

  it('shows Copied! feedback after click', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      writable: true,
      configurable: true,
    })

    render(<Footer />)
    expect(screen.getByText('abc123')).toBeInTheDocument()

    await user.click(screen.getByTestId('footer-session'))
    expect(screen.getByText('Copied!')).toBeInTheDocument()
  })

  it('toggles notifications on button click', async () => {
    const user = userEvent.setup()

    render(<Footer />)
    const toggle = screen.getByTestId('footer-notifications-toggle')
    // Disabled: title says "disabled"
    expect(toggle).toHaveAttribute('title', 'Notifications - disabled')

    await user.click(toggle)
    expect(mockSetNotificationsEnabled).toHaveBeenCalledWith(true)
  })

  it('shows enabled state when notifications on', () => {
    mockSessionDataCtx = defaultSessionDataCtx({ notificationsEnabled: true })
    render(<Footer />)
    const toggle = screen.getByTestId('footer-notifications-toggle')
    expect(toggle).toHaveAttribute('title', 'Notifications - enabled')
    expect(screen.getByLabelText('Notifications enabled')).toBeInTheDocument()
  })

  it('disables model picker when responding', () => {
    mockEventsData = defaultEventsData({ isResponding: true })
    render(<Footer />)
    expect(screen.getByTestId('footer-model')).toHaveAttribute('data-disabled', 'true')
  })

  it('enables model picker when idle', () => {
    render(<Footer />)
    expect(screen.getByTestId('footer-model')).toHaveAttribute('data-disabled', 'false')
  })

  it('enables model picker when no sessionId (empty session state)', () => {
    mockSessionDataCtx = defaultSessionDataCtx({ sessionId: null })
    render(<Footer />)
    expect(screen.getByTestId('footer-model')).toHaveAttribute('data-disabled', 'false')
  })

  it('renders permission mode picker in footer', () => {
    render(<Footer />)
    expect(screen.getByTestId('footer-permission-mode-picker')).toBeInTheDocument()
  })

  it('disables permission mode picker when responding', () => {
    mockEventsData = defaultEventsData({ isResponding: true })
    render(<Footer />)
    expect(screen.getByTestId('footer-permission-mode-picker')).toHaveAttribute(
      'data-disabled',
      'true',
    )
  })

  it('disables permission mode picker when submitting', () => {
    mockInteractionData = defaultInteractionData({ isSubmitting: true })
    render(<Footer />)
    expect(screen.getByTestId('footer-permission-mode-picker')).toHaveAttribute(
      'data-disabled',
      'true',
    )
  })

  it('enables permission mode picker when idle', () => {
    render(<Footer />)
    expect(screen.getByTestId('footer-permission-mode-picker')).toHaveAttribute(
      'data-disabled',
      'false',
    )
  })

  it('enables permission mode picker when no sessionId (empty session state)', () => {
    mockSessionDataCtx = defaultSessionDataCtx({ sessionId: null })
    render(<Footer />)
    expect(screen.getByTestId('footer-permission-mode-picker')).toHaveAttribute(
      'data-disabled',
      'false',
    )
  })
})

describe('Claude status indicator', () => {
  it('renders claude status dot', () => {
    render(<Footer />)
    expect(screen.getByTestId('footer-claude-status')).toBeInTheDocument()
  })

  it('opens status.claude.com on click', async () => {
    const user = userEvent.setup()
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => {})

    render(<Footer />)
    await user.click(screen.getByTestId('footer-claude-status'))

    expect(windowOpen).toHaveBeenCalledWith('https://status.claude.com', '_blank')
    windowOpen.mockRestore()
  })
})

describe('Footer empty/new session state', () => {
  function newEmptySessionData() {
    return {
      sessionId: 'new-sess-x',
      workspace: '/w/proj',
      model: 'claude-opus-4-8',
      effortLevel: 'medium',
      permissionMode: 'plan',
      sessionDir: '/tmp/sessions/new-sess-x',
      numTurns: 0,
      totalCostUsd: 0,
      totalDurationMs: 0,
      lastContextTokens: 0,
      contextWindow: 200000,
      notificationsEnabled: false,
      availableEffortLevels: [{ id: 'medium', name: 'Medium' }],
    }
  }

  it('shows workspace, model, effort, sessionId immediately on new empty session', () => {
    mockSessionDataCtx = newEmptySessionData()
    render(<Footer />)
    expect(screen.getByText('proj')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(screen.getByText('new-sess-x')).toBeInTheDocument()
    expect(screen.getByTestId('footer-permission-mode-picker')).toHaveAttribute(
      'data-disabled',
      'false',
    )
  })

  it('renders effort level on new empty session', () => {
    mockSessionDataCtx = newEmptySessionData()
    render(<Footer />)
    const effort = screen.getByTestId('footer-effort')
    expect(effort).toBeInTheDocument()
    expect(effort).toHaveTextContent('medium')
  })

  it('footer pickers all clickable on empty session', () => {
    mockSessionDataCtx = newEmptySessionData()
    mockEventsData = defaultEventsData()
    render(<Footer />)
    expect(screen.getByTestId('footer-model')).toHaveAttribute('data-disabled', 'false')
    expect(screen.getByTestId('footer-effort')).toHaveAttribute('data-disabled', 'false')
    expect(screen.getByTestId('footer-permission-mode-picker')).toHaveAttribute(
      'data-disabled',
      'false',
    )
  })
})
