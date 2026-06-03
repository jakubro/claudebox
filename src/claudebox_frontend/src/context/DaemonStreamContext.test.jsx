/** Tests for DaemonStreamContext. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../hooks/useDaemonStream', () => ({
  default: () => ({
    progressMessage: 'Loading...',
    clearProgress: vi.fn(),
    sessionsChanged: 5,
    lastSessionsChangedContainerId: 'ctr-1',
    containerStatus: 3,
    lastContainerEvent: null,
    daemonConnected: true,
    daemonReconnected: 1,
  }),
}))

import { DaemonStreamProvider, useDaemonStreamContext } from './DaemonStreamContext'

function TestConsumer() {
  const ctx = useDaemonStreamContext()
  return (
    <div>
      <span data-testid="progress">{ctx.progressMessage}</span>
      <span data-testid="sessionsChanged">{ctx.sessionsChanged}</span>
      <span data-testid="lastContainerId">{ctx.lastSessionsChangedContainerId}</span>
      <span data-testid="containerStatus">{ctx.containerStatus}</span>
      <span data-testid="lastContainerEvent">{String(ctx.lastContainerEvent)}</span>
      <span data-testid="connected">{String(ctx.daemonConnected)}</span>
      <span data-testid="reconnected">{ctx.daemonReconnected}</span>
    </div>
  )
}

describe('DaemonStreamContext', () => {
  it('provides daemon stream data to children', () => {
    render(
      <DaemonStreamProvider>
        <TestConsumer />
      </DaemonStreamProvider>,
    )

    expect(screen.getByTestId('progress').textContent).toBe('Loading...')
    expect(screen.getByTestId('sessionsChanged').textContent).toBe('5')
    expect(screen.getByTestId('lastContainerId').textContent).toBe('ctr-1')
    expect(screen.getByTestId('containerStatus').textContent).toBe('3')
    expect(screen.getByTestId('lastContainerEvent').textContent).toBe('null')
    expect(screen.getByTestId('connected').textContent).toBe('true')
    expect(screen.getByTestId('reconnected').textContent).toBe('1')
  })

  it('useDaemonStreamContext throws outside provider', () => {
    expect(() => render(<TestConsumer />)).toThrow(
      'useDaemonStreamContext must be used within DaemonStreamProvider',
    )
  })
})
