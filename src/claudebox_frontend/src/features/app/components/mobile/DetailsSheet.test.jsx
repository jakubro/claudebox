/** Tests for DetailsSheet component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DetailsSheet from './DetailsSheet'

// Mock contexts
const mockEventsCtx = { connectionStatus: 'connected' }
vi.mock('../../../../context/EventsContext', () => ({
  useEvents: () => mockEventsCtx,
}))

const mockSessionDataCtx = {
  workspace: '/home/user/project',
  numTurns: 12,
  totalCostUsd: 1.5,
  totalDurationMs: 65000,
  lastContextTokens: 80000,
  contextWindow: 200000,
  model: 'claude-sonnet-4-20250514',
  effortLevel: 'high',
  permissionMode: 'auto',
}
vi.mock('../../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionDataCtx,
}))

// Mock formatters
vi.mock('../../../../utils/formatters', () => ({
  formatDurationClock: ms =>
    `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`,
  getWorkspaceName: ws => (ws ? ws.split('/').pop() : null),
}))

describe('DetailsSheet', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    onClose.mockReset()
    mockEventsCtx.connectionStatus = 'connected'
    mockSessionDataCtx.workspace = '/home/user/project'
    mockSessionDataCtx.numTurns = 12
    mockSessionDataCtx.totalCostUsd = 1.5
    mockSessionDataCtx.totalDurationMs = 65000
    mockSessionDataCtx.lastContextTokens = 80000
    mockSessionDataCtx.contextWindow = 200000
    mockSessionDataCtx.model = 'claude-sonnet-4-20250514'
    mockSessionDataCtx.effortLevel = 'high'
    mockSessionDataCtx.permissionMode = 'auto'
  })

  it('renders connected status', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('renders disconnected status', () => {
    mockEventsCtx.connectionStatus = 'disconnected'

    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('renders workspace name', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('project')).toBeInTheDocument()
  })

  it('renders turn count', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('renders cost formatted to two decimals', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('$1.50')).toBeInTheDocument()
  })

  it('renders formatted duration', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  it('renders context percentage', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('renders model name', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('claude-sonnet-4-20250514')).toBeInTheDocument()
  })

  it('renders effort level', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('renders permission mode', () => {
    render(<DetailsSheet onClose={onClose} />)

    expect(screen.getByText('auto')).toBeInTheDocument()
  })

  it('calls onClose when overlay is clicked', async () => {
    const user = userEvent.setup()

    const { container } = render(<DetailsSheet onClose={onClose} />)

    const overlay = container.querySelector('.details-sheet-overlay')
    await user.click(overlay)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose when inner sheet is clicked', async () => {
    const user = userEvent.setup()

    const { container } = render(<DetailsSheet onClose={onClose} />)

    const sheet = container.querySelector('.details-sheet')
    await user.click(sheet)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows dash when workspace is empty', () => {
    mockSessionDataCtx.workspace = ''

    render(<DetailsSheet onClose={onClose} />)

    const labels = screen.getAllByText('Workspace')
    const row = labels[0].closest('.details-sheet-row')
    expect(row.textContent).toContain('-')
  })
})
