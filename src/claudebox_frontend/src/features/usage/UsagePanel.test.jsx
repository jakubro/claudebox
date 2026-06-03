/** Tests for UsagePanel. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock SessionsContext — UsagePanel now consumes useSessionsList
let mockSessions = []
vi.mock('../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions }),
}))

// Mock formatCost to keep test assertions simple and decoupled
vi.mock('../../utils/formatters', () => ({
  formatCost: cost => `$${cost.toFixed(2)}`,
}))

import UsagePanel from './UsagePanel'

describe('UsagePanel', () => {
  beforeEach(() => {
    mockSessions = []
  })

  it('renders 4 interval rows (24h, 7d, 30d, all)', () => {
    render(<UsagePanel />)

    expect(screen.getByText('24 hours')).toBeInTheDocument()
    expect(screen.getByText('7 days')).toBeInTheDocument()
    expect(screen.getByText('30 days')).toBeInTheDocument()
    expect(screen.getByText('All time')).toBeInTheDocument()
  })

  it('shows $0.00 for all intervals when no sessions', () => {
    render(<UsagePanel />)

    const costs = screen.getAllByText('$0.00')
    expect(costs).toHaveLength(4)
  })

  it('aggregates cost for sessions within 24h interval', () => {
    const now = Date.now()
    mockSessions = [
      { started_at: new Date(now - 1000).toISOString(), total_cost_usd: 1.5 },
      { started_at: new Date(now - 2000).toISOString(), total_cost_usd: 2.5 },
    ]

    render(<UsagePanel />)

    // All sessions are within 24h, so all intervals should show $4.00
    const costs = screen.getAllByText('$4.00')
    expect(costs).toHaveLength(4)
  })

  it('filters sessions outside the 24h window but includes in wider intervals', () => {
    const now = Date.now()
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000
    mockSessions = [
      { started_at: new Date(now - 1000).toISOString(), total_cost_usd: 1.0 },
      { started_at: new Date(twoDaysAgo).toISOString(), total_cost_usd: 3.0 },
    ]

    render(<UsagePanel />)

    // 24h: only $1.00
    expect(screen.getByText('$1.00')).toBeInTheDocument()
    // 7d, 30d, all: $4.00
    const fourDollar = screen.getAllByText('$4.00')
    expect(fourDollar).toHaveLength(3)
  })

  it('separates 7d and 30d intervals correctly', () => {
    const now = Date.now()
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000
    mockSessions = [
      { started_at: new Date(now - 1000).toISOString(), total_cost_usd: 1.0 },
      { started_at: new Date(tenDaysAgo).toISOString(), total_cost_usd: 5.0 },
    ]

    render(<UsagePanel />)

    // 24h: $1.00, 7d: $1.00, 30d: $6.00, All: $6.00
    const oneDollar = screen.getAllByText('$1.00')
    expect(oneDollar).toHaveLength(2) // 24h and 7d
    const sixDollar = screen.getAllByText('$6.00')
    expect(sixDollar).toHaveLength(2) // 30d and all
  })

  it('treats sessions with no total_cost_usd as 0', () => {
    const now = Date.now()
    mockSessions = [
      { started_at: new Date(now - 1000).toISOString(), total_cost_usd: 2.0 },
      { started_at: new Date(now - 2000).toISOString() }, // no cost field
    ]

    render(<UsagePanel />)

    const costs = screen.getAllByText('$2.00')
    expect(costs).toHaveLength(4)
  })

  it('renders empty when sessions list is empty (context default)', () => {
    render(<UsagePanel />)

    const costs = screen.getAllByText('$0.00')
    expect(costs).toHaveLength(4)
  })

  it('renders a usage table inside panel-usage', () => {
    render(<UsagePanel />)

    expect(screen.getByTestId('panel-usage')).toBeInTheDocument()
    expect(document.querySelector('.usage-table')).toBeInTheDocument()
  })
})
