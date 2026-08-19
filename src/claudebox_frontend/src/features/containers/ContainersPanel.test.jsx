/** Tests for ContainersPanel component. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ContainersPanel from './ContainersPanel'

vi.mock('./ContainerRow', () => ({
  default: ({ container }) => <div data-testid={`row-${container.id}`}>{container.status}</div>,
}))

const mockContainerList = { containers: [], error: null, loading: false }
vi.mock('./hooks/useContainerList', () => ({
  default: () => mockContainerList,
}))

describe('ContainersPanel', () => {
  beforeEach(() => {
    mockContainerList.containers = []
    mockContainerList.error = null
    mockContainerList.loading = false
  })

  it('renders an error state', () => {
    mockContainerList.error = new Error('boom')
    render(<ContainersPanel />)

    expect(screen.getByTestId('panel-containers')).toHaveClass('containers-error')
    expect(screen.getByText('Failed to load containers')).toBeInTheDocument()
  })

  it('renders a loading state when there are no containers yet', () => {
    mockContainerList.loading = true
    render(<ContainersPanel />)

    expect(screen.getByTestId('panel-containers')).toHaveClass('containers-loading')
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('does not show the loading state once containers have arrived', () => {
    mockContainerList.loading = true
    mockContainerList.containers = [{ id: 'c1', status: 'running' }]
    render(<ContainersPanel />)

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    expect(screen.getByTestId('row-c1')).toBeInTheDocument()
  })

  it('renders an empty state', () => {
    render(<ContainersPanel />)

    expect(screen.getByTestId('panel-containers')).toHaveClass('containers-empty')
    expect(screen.getByText('No containers')).toBeInTheDocument()
  })

  it('sorts containers by state group, running first', () => {
    mockContainerList.containers = [
      { id: 'stopped-1', status: 'stopped', created_at: '2024-01-01' },
      { id: 'running-1', status: 'running', created_at: '2024-01-01' },
      { id: 'crashed-1', status: 'crashed', created_at: '2024-01-01' },
      { id: 'starting-1', status: 'starting', created_at: '2024-01-01' },
    ]
    render(<ContainersPanel />)

    const ids = screen.getAllByTestId(/^row-/).map(el => el.dataset.testid)
    expect(ids).toEqual(['row-running-1', 'row-starting-1', 'row-crashed-1', 'row-stopped-1'])
  })

  it('sorts unknown states last, after every known state', () => {
    mockContainerList.containers = [
      { id: 'weird-1', status: 'quantum', created_at: '2024-01-01' },
      { id: 'running-1', status: 'running', created_at: '2024-01-01' },
    ]
    render(<ContainersPanel />)

    const ids = screen.getAllByTestId(/^row-/).map(el => el.dataset.testid)
    expect(ids).toEqual(['row-running-1', 'row-weird-1'])
  })

  it('breaks ties within a state group by most-recently created first', () => {
    mockContainerList.containers = [
      { id: 'older', status: 'running', created_at: '2024-01-01T00:00:00Z' },
      { id: 'newer', status: 'running', created_at: '2024-06-01T00:00:00Z' },
    ]
    render(<ContainersPanel />)

    const ids = screen.getAllByTestId(/^row-/).map(el => el.dataset.testid)
    expect(ids).toEqual(['row-newer', 'row-older'])
  })

  it('treats a missing created_at as sorting last within its state group', () => {
    mockContainerList.containers = [
      { id: 'has-date', status: 'running', created_at: '2024-01-01T00:00:00Z' },
      { id: 'no-date', status: 'running' },
    ]
    render(<ContainersPanel />)

    const ids = screen.getAllByTestId(/^row-/).map(el => el.dataset.testid)
    expect(ids).toEqual(['row-has-date', 'row-no-date'])
  })
})
