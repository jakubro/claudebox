/** Tests for LogsPanel component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LogsPanel from './LogsPanel'

// Mock LogsStreamContext
const mockLogsStream = {
  logs: [],
  isLogsReplaying: false,
  connectionStatus: 'connected',
  isResuming: false,
  isSessionReplaying: false,
  containerId: 'ctr-1',
  clearUnreadErrors: vi.fn(),
}

vi.mock('../../context/LogsStreamContext', () => ({
  useLogsStream: () => mockLogsStream,
}))

vi.mock('../../utils/formatters', () => ({
  formatTimestamp: ts => `[${ts}]`,
}))

describe('LogsPanel', () => {
  it('shows "No active session" when containerId is null', () => {
    mockLogsStream.containerId = null

    render(<LogsPanel />)

    expect(screen.getByText('No active session')).toBeDefined()
    expect(screen.getByTestId('panel-logs')).toBeDefined()

    mockLogsStream.containerId = 'ctr-1'
  })

  it('shows "Resuming..." in the loading state when isResuming is true', () => {
    mockLogsStream.isResuming = true

    render(<LogsPanel />)

    expect(screen.getByText('Resuming...')).toBeDefined()
    expect(screen.getByTestId('panel-logs')).toHaveClass('logs-loading')

    mockLogsStream.isResuming = false
  })

  it('shows "Resuming..." in the loading state when isSessionReplaying is true', () => {
    mockLogsStream.isSessionReplaying = true

    render(<LogsPanel />)

    expect(screen.getByText('Resuming...')).toBeDefined()
    expect(screen.getByTestId('panel-logs')).toHaveClass('logs-loading')

    mockLogsStream.isSessionReplaying = false
  })

  it('shows "Loading logs..." in the loading state when isLogsReplaying is true', () => {
    mockLogsStream.isLogsReplaying = true

    render(<LogsPanel />)

    expect(screen.getByText('Loading logs...')).toBeDefined()
    expect(screen.getByTestId('panel-logs')).toHaveClass('logs-loading')

    mockLogsStream.isLogsReplaying = false
  })

  it('shows "No logs yet" in the empty state when logs are empty and connected', () => {
    mockLogsStream.logs = []
    mockLogsStream.connectionStatus = 'connected'

    render(<LogsPanel />)

    expect(screen.getByText('No logs yet')).toBeDefined()
    expect(screen.getByTestId('panel-logs')).toHaveClass('logs-empty')
  })

  it('shows "Connecting..." in the loading state when logs are empty and disconnected', () => {
    mockLogsStream.logs = []
    mockLogsStream.connectionStatus = 'disconnected'

    render(<LogsPanel />)

    expect(screen.getByText('Connecting...')).toBeDefined()
    // Connecting is a loading state (waiting for connection), not an empty state.
    const root = screen.getByTestId('panel-logs')
    expect(root).toHaveClass('logs-loading')
    expect(root).not.toHaveClass('logs-empty')

    mockLogsStream.connectionStatus = 'connected'
  })

  it('renders log lines with timestamp, level, logger, and message', () => {
    mockLogsStream.logs = [
      { timestamp: '2026-01-01T00:00:00Z', level: 'INFO', logger: 'app', message: 'Started' },
      {
        timestamp: '2026-01-01T00:00:01Z',
        level: 'ERROR',
        logger: 'db',
        message: 'Connection lost',
      },
    ]

    render(<LogsPanel />)

    expect(screen.getByText('[2026-01-01T00:00:00Z]')).toBeDefined()
    expect(screen.getByText('INFO')).toBeDefined()
    expect(screen.getByText('app')).toBeDefined()
    expect(screen.getByText('Started')).toBeDefined()

    expect(screen.getByText('[2026-01-01T00:00:01Z]')).toBeDefined()
    expect(screen.getByText('ERROR')).toBeDefined()
    expect(screen.getByText('db')).toBeDefined()
    expect(screen.getByText('Connection lost')).toBeDefined()

    mockLogsStream.logs = []
  })

  it('calls clearUnreadErrors on mount', () => {
    mockLogsStream.clearUnreadErrors.mockClear()

    render(<LogsPanel />)

    expect(mockLogsStream.clearUnreadErrors).toHaveBeenCalled()
  })
})
