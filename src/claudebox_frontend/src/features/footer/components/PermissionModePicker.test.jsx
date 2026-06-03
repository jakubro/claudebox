/** Tests for PermissionModePicker component. */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockCapabilities } from '../../../test-utils/mockCapabilities'
import PermissionModePicker from './PermissionModePicker'

const mockPermissionModes = [
  { id: 'bypassPermissions', name: 'Bypass', description: 'Bypass all permission checks' },
  { id: 'plan', name: 'Plan', description: 'Planning mode' },
  { id: 'default', name: 'Default', description: 'Standard permission behavior' },
  { id: 'acceptEdits', name: 'Accept Edits', description: 'Auto-accept file edits' },
  { id: 'dontAsk', name: "Don't Ask", description: 'Allow all tools without prompting' },
  { id: 'auto', name: 'Auto', description: 'Automatically determine permission mode' },
]

const mockSetPermissionMode = vi.fn()
let mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({
    availablePermissionModes: mockPermissionModes,
  }),
  useSessionActions: () => ({
    setPermissionMode: mockSetPermissionMode,
  }),
}))

vi.mock('../../../hooks/useCapabilities', () => ({
  default: () => mockUseCapabilities,
}))

vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="icon-check">✓</span>,
  ChevronDown: () => <span data-testid="icon-chevron">▼</span>,
}))

beforeEach(() => {
  mockSetPermissionMode.mockClear()
  mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }
})

describe('PermissionModePicker', () => {
  it('renders current permission mode name from prop', () => {
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />)
    expect(screen.getByText('Bypass')).toBeInTheDocument()
  })

  it('shows dash when no currentPermissionMode prop', () => {
    render(<PermissionModePicker currentPermissionMode={null} disabled={false} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('opens dropdown on click', async () => {
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))
    expect(screen.getByTestId('permission-mode-dropdown')).toBeInTheDocument()
  })

  it('lists all available permission modes', async () => {
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))

    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Accept Edits')).toBeInTheDocument()
    expect(screen.getByText("Don't Ask")).toBeInTheDocument()
    expect(screen.getByText('Auto')).toBeInTheDocument()
  })

  it('exposes all 6 SDK permission modes', async () => {
    // SDK contract: claude_agent_sdk.types.PermissionMode declares 6 literals.
    // Picker must surface every one so users can select any mode the SDK supports.
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="default" disabled={false} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))

    const dropdown = screen.getByTestId('permission-mode-dropdown')
    const optionNames = Array.from(
      dropdown.querySelectorAll('.footer-permission-mode-option-name'),
    ).map(el => el.textContent)
    expect(new Set(optionNames)).toEqual(
      new Set(['Default', 'Plan', 'Accept Edits', 'Bypass', "Don't Ask", 'Auto']),
    )
    // Six options total (no duplicates, no extras).
    expect(dropdown.querySelectorAll('.footer-permission-mode-option').length).toBe(6)
  })

  it('highlights current permission mode with checkmark', async () => {
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))

    const dropdown = screen.getByTestId('permission-mode-dropdown')
    const checkmarks = within(dropdown).getAllByTestId('icon-check')
    expect(checkmarks).toHaveLength(1)

    const bypassOption = within(dropdown)
      .getByText('Bypass')
      .closest('.footer-permission-mode-option')
    expect(bypassOption).toHaveClass('selected')
  })

  it('calls setPermissionMode on selection', async () => {
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))
    await user.click(screen.getByText('Plan'))
    expect(mockSetPermissionMode).toHaveBeenCalledWith('plan')
  })

  it('closes dropdown on selection', async () => {
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))
    await user.click(screen.getByText('Plan'))
    expect(screen.queryByTestId('permission-mode-dropdown')).not.toBeInTheDocument()
  })

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))

    await waitFor(() => {
      expect(screen.getByTestId('permission-mode-dropdown')).toBeInTheDocument()
    })

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('permission-mode-dropdown')).not.toBeInTheDocument()
  })

  it('closes dropdown on click outside', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <span data-testid="outside">outside</span>
        <PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />
      </div>,
    )

    await user.click(screen.getByTestId('footer-permission-mode-picker'))

    await waitFor(() => {
      expect(screen.getByTestId('permission-mode-dropdown')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('outside'))
    expect(screen.queryByTestId('permission-mode-dropdown')).not.toBeInTheDocument()
  })

  it('does not open when disabled', async () => {
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={true} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))
    expect(screen.queryByTestId('permission-mode-dropdown')).not.toBeInTheDocument()
  })

  it('does not call setPermissionMode when selecting current permission mode', async () => {
    const user = userEvent.setup()
    render(<PermissionModePicker currentPermissionMode="bypassPermissions" disabled={false} />)

    await user.click(screen.getByTestId('footer-permission-mode-picker'))

    const dropdown = screen.getByTestId('permission-mode-dropdown')
    await user.click(within(dropdown).getByText('Bypass'))
    expect(mockSetPermissionMode).not.toHaveBeenCalled()
  })

  describe('capability gating', () => {
    it('renders during the capability race', () => {
      mockUseCapabilities = { capabilities: null, runtimeName: null }
      render(<PermissionModePicker currentPermissionMode="default" disabled={false} />)
      expect(screen.getByTestId('footer-permission-mode-picker')).toBeInTheDocument()
    })

    it('hides when supports_permission_modes is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_permission_modes: false }),
        runtimeName: 'Goose',
      }
      render(<PermissionModePicker currentPermissionMode="default" disabled={false} />)
      expect(screen.queryByTestId('footer-permission-mode-picker')).toBeNull()
    })

    it('hides when supports_set_permission_mode is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_set_permission_mode: false }),
        runtimeName: 'Goose',
      }
      render(<PermissionModePicker currentPermissionMode="default" disabled={false} />)
      expect(screen.queryByTestId('footer-permission-mode-picker')).toBeNull()
    })
  })
})
