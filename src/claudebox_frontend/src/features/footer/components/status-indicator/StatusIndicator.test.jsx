/** Tests for StatusIndicator component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StatusIndicator from './StatusIndicator'

const defaultProps = {
  connectionStatus: 'connected',
  connectionError: null,
  isResponding: false,
  respondingSince: null,
  lastEventTimestamp: null,
  isSubmitting: false,
  isAwaitingResponse: false,
  interruptStatus: null,
  errorMessage: null,
  isReplaying: false,
  isCreating: false,
}

describe('StatusIndicator', () => {
  it('renders resuming state when isReplaying is true', () => {
    render(<StatusIndicator {...defaultProps} isReplaying={true} />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'resuming')
    expect(screen.getByText('Resuming')).toBeInTheDocument()
  })

  it('renders error state when errorMessage is set', () => {
    render(<StatusIndicator {...defaultProps} errorMessage="Something went wrong" />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'error')
    expect(dot).toHaveClass('status-error')
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders stopping state when interruptStatus is stopping', () => {
    render(<StatusIndicator {...defaultProps} interruptStatus="stopping" />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'stopping')
    expect(dot).toHaveClass('status-stopping')
    expect(screen.getByText('Stopping')).toBeInTheDocument()
  })

  it('renders stopped state when interruptStatus is stopped', () => {
    render(<StatusIndicator {...defaultProps} interruptStatus="stopped" />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'stopped')
    expect(dot).toHaveClass('status-stopped')
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  it('renders working state when isResponding is true', () => {
    render(<StatusIndicator {...defaultProps} isResponding={true} />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'working')
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+. to stop')).toBeInTheDocument()
  })

  it('renders working state when isAwaitingResponse is true', () => {
    render(<StatusIndicator {...defaultProps} isAwaitingResponse={true} />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'working')
    expect(screen.getByText('Working')).toBeInTheDocument()
  })

  it('renders submitting state when isSubmitting is true', () => {
    render(<StatusIndicator {...defaultProps} isSubmitting={true} />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'submitting')
    expect(screen.getByText('Submitting')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+. to stop')).toBeInTheDocument()
  })

  it('renders ready state when connected and idle', () => {
    render(<StatusIndicator {...defaultProps} />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'ready')
    expect(dot).toHaveClass('status-connected')
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('renders reconnecting state with animated dots', () => {
    render(<StatusIndicator {...defaultProps} connectionStatus="reconnecting" />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'reconnecting')
    expect(dot).toHaveClass('status-error')
    expect(screen.getByText('Reconnecting')).toBeInTheDocument()
  })

  it('renders disconnected state with connection error', () => {
    render(
      <StatusIndicator
        {...defaultProps}
        connectionStatus="disconnected"
        connectionError="timeout"
      />,
    )

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'disconnected')
    expect(dot).toHaveClass('status-disconnected')
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
    expect(screen.getByText('(timeout)')).toBeInTheDocument()
  })

  it('prioritizes resuming over error state', () => {
    render(<StatusIndicator {...defaultProps} isReplaying={true} errorMessage="err" />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'resuming')
  })

  it('prioritizes error over stopping state', () => {
    render(<StatusIndicator {...defaultProps} errorMessage="err" interruptStatus="stopping" />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'error')
  })

  it('renders creating session state when isCreating is true', () => {
    render(<StatusIndicator {...defaultProps} isCreating={true} />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'creating')
    expect(dot).toHaveClass('status-working')
    expect(screen.getByText('Creating session')).toBeInTheDocument()
  })

  it('prioritizes resuming over creating state', () => {
    render(<StatusIndicator {...defaultProps} isReplaying={true} isCreating={true} />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'resuming')
  })

  it('prioritizes creating over error state', () => {
    render(<StatusIndicator {...defaultProps} isCreating={true} errorMessage="err" />)

    const dot = screen.getByTestId('footer-status')
    expect(dot).toHaveAttribute('data-status', 'creating')
  })
})
