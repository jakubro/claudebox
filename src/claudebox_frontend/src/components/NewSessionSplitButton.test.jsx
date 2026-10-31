/** Tests for NewSessionSplitButton - split-button for creating new sessions. */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockExecute = vi.fn()
let mockExecuteInNewTab = vi.fn()
let mockIsCreating = false
let mockIsCreatingInNewTab = false

vi.mock('../hooks/useNewSession', () => ({
  default: () => ({
    executeNewSession: mockExecute,
    executeNewSessionInNewTab: mockExecuteInNewTab,
    isCreating: mockIsCreating,
    isCreatingInNewTab: mockIsCreatingInNewTab,
  }),
}))

let mockSessionDefaults = null

vi.mock('../hooks/useSessionDefaults', () => ({
  default: () => mockSessionDefaults,
}))

import NewSessionSplitButton from './NewSessionSplitButton'

describe('NewSessionSplitButton', () => {
  beforeEach(() => {
    mockExecute = vi.fn()
    mockExecuteInNewTab = vi.fn()
    mockIsCreating = false
    mockIsCreatingInNewTab = false
    mockSessionDefaults = null
  })

  it('renders main button with default data-testid prefix `session-`', () => {
    render(<NewSessionSplitButton />)
    expect(screen.getByTestId('session-new-session-btn')).toBeInTheDocument()
  })

  it('renders main button with custom data-testid prefix', () => {
    render(<NewSessionSplitButton dataTestIdPrefix="header" />)
    expect(screen.getByTestId('header-new-session-btn')).toBeInTheDocument()
  })

  it('plain click triggers executeNewSession (current browser tab)', () => {
    render(<NewSessionSplitButton />)
    fireEvent.click(screen.getByTestId('session-new-session-btn'))
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockExecuteInNewTab).not.toHaveBeenCalled()
  })

  it('Alt-click triggers executeNewSessionInNewTab (new browser tab)', () => {
    render(<NewSessionSplitButton />)
    fireEvent.click(screen.getByTestId('session-new-session-btn'), { altKey: true })
    expect(mockExecuteInNewTab).toHaveBeenCalledTimes(1)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('middle-click triggers executeNewSessionInNewTab', () => {
    render(<NewSessionSplitButton />)
    fireEvent(
      screen.getByTestId('session-new-session-btn'),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    )
    expect(mockExecuteInNewTab).toHaveBeenCalledTimes(1)
  })

  it('main button is disabled while creating', () => {
    mockIsCreating = true
    render(<NewSessionSplitButton />)
    expect(screen.getByTestId('session-new-session-btn')).toBeDisabled()
  })

  it('chevron toggles dropdown - opens then closes', async () => {
    const user = userEvent.setup()
    render(<NewSessionSplitButton />)

    expect(screen.queryByText('New session in new browser tab')).not.toBeInTheDocument()

    const chevron = screen.getByTitle('More start options')
    await user.click(chevron)

    expect(screen.getByText('New session')).toBeInTheDocument()
    expect(screen.getByText('New session in new browser tab')).toBeInTheDocument()

    await user.click(chevron)
    expect(screen.queryByText('New session in new browser tab')).not.toBeInTheDocument()
  })

  it('dropdown "New session" option triggers executeNewSession and closes dropdown', async () => {
    const user = userEvent.setup()
    render(<NewSessionSplitButton />)

    await user.click(screen.getByTitle('More start options'))
    await user.click(screen.getByText('New session'))

    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('New session in new browser tab')).not.toBeInTheDocument()
  })

  it('dropdown "New session in new browser tab" option triggers executeNewSessionInNewTab', async () => {
    const user = userEvent.setup()
    render(<NewSessionSplitButton />)

    await user.click(screen.getByTitle('More start options'))
    await user.click(screen.getByText('New session in new browser tab'))

    expect(mockExecuteInNewTab).toHaveBeenCalledTimes(1)
  })

  it('renders dropdown via portal when dropdownPlacement="portal"', async () => {
    const user = userEvent.setup()
    render(<NewSessionSplitButton dropdownPlacement="portal" />)

    await user.click(screen.getByTitle('More start options'))

    const dropdown = screen.getByText('New session').closest('.new-session-dropdown')
    expect(dropdown).toHaveClass('new-session-dropdown-portal')
  })

  it('lists one row per declared bundle after a divider, in declaration order', async () => {
    mockSessionDefaults = { bundle_names: ['research', 'ops'] }
    const user = userEvent.setup()
    const { container } = render(<NewSessionSplitButton dataTestIdPrefix="header" />)

    await user.click(screen.getByTitle('More start options'))

    const rows = [...container.querySelectorAll('.dropdown-option')].map(el => el.textContent)
    expect(rows).toEqual([
      'New session',
      'New session in new browser tab',
      'New session - research',
      'New session - ops',
    ])
    expect(container.querySelector('.new-session-dropdown-divider')).not.toBeNull()
  })

  it('a bundle row creates a session under that bundle', async () => {
    mockSessionDefaults = { bundle_names: ['research'] }
    const user = userEvent.setup()
    render(<NewSessionSplitButton dataTestIdPrefix="header" />)

    await user.click(screen.getByTitle('More start options'))
    await user.click(screen.getByTestId('header-new-session-bundle-research'))

    expect(mockExecute).toHaveBeenCalledWith('research')
  })

  it('a workspace with no bundles shows no divider and no bundle rows', async () => {
    mockSessionDefaults = { bundle_names: [] }
    const user = userEvent.setup()
    const { container } = render(<NewSessionSplitButton />)

    await user.click(screen.getByTitle('More start options'))

    expect(container.querySelectorAll('.dropdown-option')).toHaveLength(2)
    expect(container.querySelector('.new-session-dropdown-divider')).toBeNull()
  })
})
