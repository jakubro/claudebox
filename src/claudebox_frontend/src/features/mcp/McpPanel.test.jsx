/** Tests for McpPanel component. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockCapabilities } from '../../test-utils/mockCapabilities'

// Mock useEvents with dynamic events and replay state
let mockEvents = []
let mockIsResuming = false
let mockIsReplaying = false

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => ({
    events: mockEvents,
    isResuming: mockIsResuming,
    isReplaying: mockIsReplaying,
  }),
}))

// Mutable mock for API calls
let mockReconnectMcpServer = vi.fn()
let mockToggleMcpServer = vi.fn()

vi.mock('../../api/mcp', () => ({
  reconnectMcpServer: (...args) => mockReconnectMcpServer(...args),
  toggleMcpServer: (...args) => mockToggleMcpServer(...args),
}))

let mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }

vi.mock('../../hooks/useCapabilities', () => ({
  default: () => mockUseCapabilities,
}))

import McpPanel from './McpPanel'

// Helper to create init event with MCP servers
const createInitEvent = mcpServers => ({
  type: 'system',
  subtype: 'init',
  message_data: {
    mcp_servers: mcpServers,
  },
})

const renderWithEvents = (events = []) => {
  mockEvents = events
  return render(<McpPanel />)
}

describe('McpPanel', () => {
  beforeEach(() => {
    mockEvents = []
    mockIsResuming = false
    mockIsReplaying = false
    mockReconnectMcpServer = vi.fn()
    mockToggleMcpServer = vi.fn()
    mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }
  })

  it('renders empty state when no MCP servers', () => {
    renderWithEvents([])

    expect(screen.getByText('No MCP servers connected')).toBeInTheDocument()
  })

  it('renders server list from init event', () => {
    const events = [
      createInitEvent([
        { name: 'jina', status: 'connected' },
        { name: 'deepwiki', status: 'connected' },
      ]),
    ]
    renderWithEvents(events)

    expect(screen.getByText('jina')).toBeInTheDocument()
    expect(screen.getByText('deepwiki')).toBeInTheDocument()
  })

  it('shows connected status indicator', () => {
    const events = [createInitEvent([{ name: 'test-server', status: 'connected' }])]
    renderWithEvents(events)

    expect(screen.getByTitle('connected')).toBeInTheDocument()
  })

  it('shows disconnected status indicator and text', () => {
    const events = [createInitEvent([{ name: 'test-server', status: 'disconnected' }])]
    renderWithEvents(events)

    expect(screen.getByTitle('disconnected')).toBeInTheDocument()
    expect(screen.getByText('disconnected')).toBeInTheDocument()
  })

  it('uses latest init event', () => {
    const events = [
      createInitEvent([{ name: 'old-server', status: 'connected' }]),
      createInitEvent([{ name: 'new-server', status: 'connected' }]),
    ]
    renderWithEvents(events)

    expect(screen.queryByText('old-server')).not.toBeInTheDocument()
    expect(screen.getByText('new-server')).toBeInTheDocument()
  })

  it('shows disable button for connected servers', () => {
    const events = [createInitEvent([{ name: 'jina', status: 'connected' }])]
    renderWithEvents(events)

    expect(screen.getByTitle('Disable')).toBeInTheDocument()
  })

  it('shows enable button for disabled servers', () => {
    const events = [createInitEvent([{ name: 'jina', status: 'disabled' }])]
    renderWithEvents(events)

    expect(screen.getByTitle('Enable')).toBeInTheDocument()
  })

  it('shows reconnect button for disconnected servers', () => {
    const events = [createInitEvent([{ name: 'jina', status: 'disconnected' }])]
    renderWithEvents(events)

    expect(screen.getByTitle('Reconnect')).toBeInTheDocument()
  })

  it('shows reconnect button for failed servers', () => {
    const events = [createInitEvent([{ name: 'jina', status: 'failed' }])]
    renderWithEvents(events)

    expect(screen.getByTitle('Reconnect')).toBeInTheDocument()
  })

  it('does not show reconnect button for connected servers', () => {
    const events = [createInitEvent([{ name: 'jina', status: 'connected' }])]
    renderWithEvents(events)

    expect(screen.queryByTitle('Reconnect')).not.toBeInTheDocument()
  })

  it('calls reconnectMcpServer and updates status on success', async () => {
    mockReconnectMcpServer.mockResolvedValue({
      mcpServers: [{ name: 'jina', status: 'connected' }],
    })
    const events = [createInitEvent([{ name: 'jina', status: 'failed' }])]
    renderWithEvents(events)

    fireEvent.click(screen.getByTitle('Reconnect'))

    await waitFor(() => {
      expect(mockReconnectMcpServer).toHaveBeenCalledWith('jina')
    })

    await waitFor(() => {
      expect(screen.getByTitle('connected')).toBeInTheDocument()
    })
  })

  it('calls toggleMcpServer to disable and updates status', async () => {
    mockToggleMcpServer.mockResolvedValue({
      mcpServers: [{ name: 'jina', status: 'disabled' }],
    })
    const events = [createInitEvent([{ name: 'jina', status: 'connected' }])]
    renderWithEvents(events)

    fireEvent.click(screen.getByTitle('Disable'))

    await waitFor(() => {
      expect(mockToggleMcpServer).toHaveBeenCalledWith('jina', false)
    })

    await waitFor(() => {
      expect(screen.getByTitle('Enable')).toBeInTheDocument()
    })
  })

  it('calls toggleMcpServer to enable and updates status', async () => {
    mockToggleMcpServer.mockResolvedValue({
      mcpServers: [{ name: 'jina', status: 'connected' }],
    })
    const events = [createInitEvent([{ name: 'jina', status: 'disabled' }])]
    renderWithEvents(events)

    fireEvent.click(screen.getByTitle('Enable'))

    await waitFor(() => {
      expect(mockToggleMcpServer).toHaveBeenCalledWith('jina', true)
    })
  })

  it('shows error message on reconnect failure', async () => {
    mockReconnectMcpServer.mockRejectedValue(new Error('Network error'))
    const events = [createInitEvent([{ name: 'jina', status: 'failed' }])]
    renderWithEvents(events)

    fireEvent.click(screen.getByTitle('Reconnect'))

    await waitFor(() => {
      expect(screen.getByText('Failed to reconnect jina')).toBeInTheDocument()
    })
  })

  it('shows error message on toggle failure', async () => {
    mockToggleMcpServer.mockRejectedValue(new Error('Network error'))
    const events = [createInitEvent([{ name: 'jina', status: 'connected' }])]
    renderWithEvents(events)

    fireEvent.click(screen.getByTitle('Disable'))

    await waitFor(() => {
      expect(screen.getByText('Failed to disable jina')).toBeInTheDocument()
    })
  })
})

describe('McpPanel isReplaying', () => {
  beforeEach(() => {
    mockEvents = []
    mockIsResuming = false
    mockIsReplaying = false
    mockReconnectMcpServer = vi.fn()
    mockToggleMcpServer = vi.fn()
  })

  it('renders "Resuming..." when isReplaying is true', () => {
    mockIsReplaying = true
    mockEvents = [createInitEvent([{ name: 'some-server', status: 'connected' }])]

    render(<McpPanel />)

    expect(screen.getByText('Resuming...')).toBeInTheDocument()
    expect(screen.queryByText('some-server')).not.toBeInTheDocument()
  })

  it('shows resuming text when replaying', () => {
    mockIsReplaying = true

    render(<McpPanel />)

    expect(screen.getByText('Resuming...')).toBeInTheDocument()
  })

  it('renders server list when isReplaying is false', () => {
    mockIsReplaying = false
    mockEvents = [createInitEvent([{ name: 'active-server', status: 'connected' }])]

    render(<McpPanel />)

    expect(screen.queryByText('Resuming...')).not.toBeInTheDocument()
    expect(screen.getByText('active-server')).toBeInTheDocument()
  })

  it('renders "Resuming..." when isResuming is true (before replay starts)', () => {
    mockIsResuming = true
    mockEvents = [createInitEvent([{ name: 'some-server', status: 'connected' }])]

    render(<McpPanel />)

    expect(screen.getByText('Resuming...')).toBeInTheDocument()
    expect(screen.queryByText('some-server')).not.toBeInTheDocument()
  })

  describe('capability gating', () => {
    it('renders during the capability race', () => {
      mockUseCapabilities = { capabilities: null, runtimeName: null }
      const { container } = render(<McpPanel />)
      expect(container.querySelector('[data-testid="panel-mcp"]')).toBeInTheDocument()
    })

    it('hides when supports_mcp_delegation is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_mcp_delegation: false }),
        runtimeName: 'Goose',
      }
      const { container } = render(<McpPanel />)
      expect(container).toBeEmptyDOMElement()
    })
  })
})
