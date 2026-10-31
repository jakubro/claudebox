/** Tests for ContainerRow component. */

import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ContainerRow from './ContainerRow'

vi.mock('../../api/containers', () => ({
  deleteContainer: vi.fn(),
}))

const mockRouting = { navigateToSession: vi.fn(), activeSessionId: null }
const mockSessions = []
const mockWorkspace = { workspaceId: 'ws-1' }

vi.mock('../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => mockRouting,
}))
// useSessionsList returns { sessions }, so the mock must match that shape.
vi.mock('../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions }),
}))
vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace,
}))

function baseContainer(overrides = {}) {
  return {
    id: 'cabc111122223333',
    backend_id: 'bk1111111111-aaaa',
    status: 'running',
    created_at: '2025-05-15T08:00:00Z',
    labels: { kind: 'session' },
    session_id: 's-foo-1',
    ...overrides,
  }
}

describe('ContainerRow age', () => {
  it('keeps up as time passes while the row stays mounted', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-03-01T12:00:00Z'))
    try {
      render(<ContainerRow container={baseContainer({ created_at: '2026-03-01T12:00:00Z' })} />)

      act(() => vi.advanceTimersByTime(2 * 3600_000))

      expect(document.querySelector('.containers-age')).toHaveTextContent('2h ago')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ContainerRow', () => {
  beforeEach(() => {
    mockRouting.activeSessionId = null
    mockRouting.navigateToSession.mockClear()
    mockSessions.length = 0
  })

  it('leads with the session id right after the dot, then the container id, then the name', () => {
    render(<ContainerRow container={baseContainer()} />)

    const cells = [...screen.getByTestId('container-row-cabc111122223333').children].map(
      cell => cell.className.split(' ')[0],
    )
    expect(cells.slice(0, 4)).toEqual([
      'containers-status-dot',
      'containers-session-id',
      'containers-id',
      'containers-session-name',
    ])
  })

  it('displays the runtime backend_id (not container.id) in the id column', () => {
    render(<ContainerRow container={baseContainer()} />)

    const idCell = document.querySelector('.containers-id')
    expect(idCell.textContent).toBe('bk111111')
  })

  it('falls back to empty string when backend_id is missing', () => {
    render(<ContainerRow container={baseContainer({ backend_id: undefined })} />)

    const idCell = document.querySelector('.containers-id')
    expect(idCell.textContent).toBe('')
  })

  it('keeps container.id bound to data-testid (used by API selectors)', () => {
    render(<ContainerRow container={baseContainer()} />)

    expect(screen.getByTestId('container-row-cabc111122223333')).toBeInTheDocument()
  })

  it('renders empty session-name cell when the attached session has no custom name', () => {
    mockSessions.push({ session_id: 's-foo-1', name: '' })
    render(<ContainerRow container={baseContainer()} />)

    const nameCell = document.querySelector('.containers-session-name')
    expect(nameCell.textContent).toBe('')
    expect(screen.queryByText('(unnamed)')).not.toBeInTheDocument()
  })

  it('renders session name when present', () => {
    mockSessions.push({ session_id: 's-foo-1', name: 'Fixing the bug' })
    render(<ContainerRow container={baseContainer()} />)

    expect(screen.getByText('Fixing the bug')).toBeInTheDocument()
  })

  it('applies containers-row-current class when activeSessionId matches the row session', () => {
    mockRouting.activeSessionId = 's-foo-1'
    render(<ContainerRow container={baseContainer()} />)

    const row = screen.getByTestId('container-row-cabc111122223333')
    expect(row).toHaveClass('containers-row-current')
  })

  it('does not apply containers-row-current when activeSessionId differs from the row session', () => {
    mockRouting.activeSessionId = 's-other'
    render(<ContainerRow container={baseContainer()} />)

    const row = screen.getByTestId('container-row-cabc111122223333')
    expect(row).not.toHaveClass('containers-row-current')
  })

  it('does not apply containers-row-current when the container has no session_id', () => {
    mockRouting.activeSessionId = null
    render(<ContainerRow container={baseContainer({ session_id: null })} />)

    const row = screen.getByTestId('container-row-cabc111122223333')
    expect(row).not.toHaveClass('containers-row-current')
  })

  it('hides ResumeControl on the current container row', () => {
    mockRouting.activeSessionId = 's-foo-1'
    render(<ContainerRow container={baseContainer()} />)

    expect(screen.queryByTestId('session-resume-btn')).not.toBeInTheDocument()
  })

  it('shows ResumeControl on a non-current row that carries a session_id', () => {
    mockRouting.activeSessionId = 's-other'
    render(<ContainerRow container={baseContainer()} />)

    expect(screen.getByTestId('session-resume-btn')).toBeInTheDocument()
  })

  it('keeps the Stop button visible on the current container row while running', () => {
    mockRouting.activeSessionId = 's-foo-1'
    render(<ContainerRow container={baseContainer({ status: 'running' })} />)

    expect(screen.getByTestId('container-stop-cabc111122223333')).toBeInTheDocument()
  })

  it('renders the session-id column as an 8-character prefix (matching the Sessions panel)', () => {
    render(<ContainerRow container={baseContainer({ session_id: 'sess-abc12345-xyz' })} />)

    const cell = document.querySelector('.containers-session-id')
    expect(cell.textContent).toBe('sess-abc')
  })

  it('container-id cell carries the click-to-copy tooltip + cursor when backend_id is present', () => {
    render(<ContainerRow container={baseContainer()} />)

    const cell = document.querySelector('.containers-id')
    expect(cell).toHaveClass('containers-id-clickable')
    expect(cell.getAttribute('title')).toBe('Container — bk1111111111-aaaa')
    expect(cell.style.cursor).toBe('pointer')
  })

  it('container-id cell has no tooltip + default cursor when backend_id is missing', () => {
    render(<ContainerRow container={baseContainer({ backend_id: '' })} />)

    const cell = document.querySelector('.containers-id')
    expect(cell).not.toHaveClass('containers-id-clickable')
    expect(cell.hasAttribute('title')).toBe(false)
    expect(cell.style.cursor).toBe('')
  })

  it('clicking the container-id cell copies the full backend_id to the clipboard', () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<ContainerRow container={baseContainer()} />)

    document.querySelector('.containers-id').click()
    expect(writeText).toHaveBeenCalledWith('bk1111111111-aaaa')
  })

  it('shows the Copied! overlay after the container-id is clicked, then hides it again', async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    })
    render(<ContainerRow container={baseContainer()} />)

    act(() => {
      document.querySelector('.containers-id').click()
    })
    expect(document.querySelector('.containers-id-copied')).toBeInTheDocument()
    expect(document.querySelector('.containers-id-copied').textContent).toBe('Copied!')

    // Flush the timeout that flips the flag back.
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(document.querySelector('.containers-id-copied')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('session-id cell carries Session-directory tooltip + click-to-copy when session has session_dir', () => {
    mockSessions.push({ session_id: 's-foo-1', session_dir: '/home/u/.claudebox/sessions/s-foo-1' })
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<ContainerRow container={baseContainer()} />)

    const cell = document.querySelector('.containers-session-id')
    expect(cell).toHaveClass('containers-session-id-clickable')
    expect(cell.getAttribute('title')).toBe(
      'Session directory — /home/u/.claudebox/sessions/s-foo-1',
    )
    expect(cell.style.cursor).toBe('pointer')

    cell.click()
    expect(writeText).toHaveBeenCalledWith('/home/u/.claudebox/sessions/s-foo-1')
  })

  it('session-id cell has no tooltip + default cursor when the matched session has no session_dir', () => {
    mockSessions.push({ session_id: 's-foo-1', name: 'foo' })
    render(<ContainerRow container={baseContainer()} />)

    const cell = document.querySelector('.containers-session-id')
    expect(cell).not.toHaveClass('containers-session-id-clickable')
    expect(cell.hasAttribute('title')).toBe(false)
    expect(cell.style.cursor).toBe('')
  })

  it('session-id cell has no tooltip when the container has no session_id at all', () => {
    render(<ContainerRow container={baseContainer({ session_id: null })} />)

    const cell = document.querySelector('.containers-session-id')
    expect(cell).not.toHaveClass('containers-session-id-clickable')
    expect(cell.hasAttribute('title')).toBe(false)
    expect(cell.textContent).toBe('')
  })
})

describe('ContainerRow dot', () => {
  beforeEach(() => {
    mockSessions.length = 0
  })

  const dot = () => document.querySelector('.containers-status-dot')

  it.each([
    [{ activity: 'working' }, 'working', 'Working'],
    [{ activity: 'waiting' }, 'waiting', 'Waiting on background work'],
    [{ needs_user: 'Decide: which migration' }, 'needs-you', 'Needs you'],
  ])('shows the session state %o on a running container', (fields, state, title) => {
    mockSessions.push({ session_id: 's-foo-1', ...fields })

    render(<ContainerRow container={baseContainer()} />)

    expect(dot()).toHaveClass(`container-status-${state}`)
    expect(dot()).toHaveAttribute('title', title)
    expect(dot().style.background).toBe('')
    expect(document.querySelector('.containers-state')).toHaveTextContent('Running')
  })

  it('stays green for an idle session, whatever a side thread in its container does', () => {
    mockSessions.push(
      { session_id: 's-foo-1' },
      { session_id: 's-side-1', parent_session_id: 's-foo-1', activity: 'working' },
    )

    render(<ContainerRow container={baseContainer()} />)

    expect(dot().className).toBe('containers-status-dot')
    expect(dot().style.background).toBe('rgb(34, 197, 94)')
    expect(dot()).toHaveAttribute('title', 'Status: running')
  })

  it.each([
    ['starting', 'rgb(59, 130, 246)'],
    ['stopping', 'rgb(245, 158, 11)'],
    ['crashed', 'rgb(239, 68, 68)'],
    ['stopped', 'rgb(115, 115, 115)'],
  ])('keeps the %s colour whatever its session is doing', (status, color) => {
    mockSessions.push({ session_id: 's-foo-1', activity: 'working', needs_user: 'Decide: x' })

    render(<ContainerRow container={baseContainer({ status })} />)

    expect(dot().className).toBe('containers-status-dot')
    expect(dot().style.background).toBe(color)
    expect(dot()).toHaveAttribute('title', `Status: ${status}`)
  })
})
