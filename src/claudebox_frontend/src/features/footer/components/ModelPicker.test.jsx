/** Tests for ModelPicker component. */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockCapabilities } from '../../../test-utils/mockCapabilities'
import ModelPicker from './ModelPicker'

const mockModels = [
  { id: 'claude-opus-4-6', name: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
]

const mockSetModel = vi.fn()
let mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({ availableModels: mockModels }),
  useSessionActions: () => ({ setModel: mockSetModel }),
}))

vi.mock('../../../hooks/useCapabilities', () => ({
  default: () => mockUseCapabilities,
}))

vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="icon-check">✓</span>,
  ChevronDown: () => <span data-testid="icon-chevron">▼</span>,
}))

beforeEach(() => {
  mockSetModel.mockClear()
  mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }
})

describe('ModelPicker', () => {
  it('renders current model name', () => {
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)
    expect(screen.getByTestId('footer-model')).toHaveTextContent('Opus 4.6')
  })

  it('shows dash when currentModel is null', () => {
    render(<ModelPicker currentModel={null} disabled={false} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('opens dropdown on click', async () => {
    const user = userEvent.setup()
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)

    await user.click(screen.getByTestId('footer-model'))
    expect(screen.getByTestId('model-dropdown')).toBeInTheDocument()
  })

  it('shows models from context', async () => {
    const user = userEvent.setup()
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)

    await user.click(screen.getByTestId('footer-model'))

    const dropdown = screen.getByTestId('model-dropdown')
    expect(dropdown).toHaveTextContent('Opus 4.6')
    expect(dropdown).toHaveTextContent('Sonnet 4.6')
    expect(dropdown).toHaveTextContent('Haiku 4.5')
  })

  it('highlights current model with checkmark', async () => {
    const user = userEvent.setup()
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)

    await user.click(screen.getByTestId('footer-model'))

    const checkmarks = screen.getAllByTestId('icon-check')
    expect(checkmarks).toHaveLength(1)

    // Checkmark should be in the Opus 4.6 option
    const dropdown = screen.getByTestId('model-dropdown')
    const opusName = within(dropdown).getByText('Opus 4.6')
    expect(opusName.closest('.footer-model-option')).toHaveClass('selected')
  })

  it('calls setModel on selection', async () => {
    const user = userEvent.setup()
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)

    await user.click(screen.getByTestId('footer-model'))
    await user.click(screen.getByText('Sonnet 4.6'))
    expect(mockSetModel).toHaveBeenCalledWith('claude-sonnet-4-6')
  })

  it('closes dropdown on selection', async () => {
    const user = userEvent.setup()
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)

    await user.click(screen.getByTestId('footer-model'))
    await user.click(screen.getByText('Sonnet 4.6'))
    expect(screen.queryByTestId('model-dropdown')).not.toBeInTheDocument()
  })

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)

    await user.click(screen.getByTestId('footer-model'))

    await waitFor(() => {
      expect(screen.getByTestId('model-dropdown')).toBeInTheDocument()
    })

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('model-dropdown')).not.toBeInTheDocument()
  })

  it('closes dropdown on click outside', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <span data-testid="outside">outside</span>
        <ModelPicker currentModel="claude-opus-4-6" disabled={false} />
      </div>,
    )

    await user.click(screen.getByTestId('footer-model'))

    await waitFor(() => {
      expect(screen.getByTestId('model-dropdown')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('outside'))
    expect(screen.queryByTestId('model-dropdown')).not.toBeInTheDocument()
  })

  it('does not open when disabled', async () => {
    const user = userEvent.setup()
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={true} />)

    await user.click(screen.getByTestId('footer-model'))
    expect(screen.queryByTestId('model-dropdown')).not.toBeInTheDocument()
  })

  it('does not call setModel when selecting current model', async () => {
    const user = userEvent.setup()
    render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)

    await user.click(screen.getByTestId('footer-model'))
    const dropdown = screen.getByTestId('model-dropdown')
    await user.click(within(dropdown).getByText('Opus 4.6'))
    expect(mockSetModel).not.toHaveBeenCalled()
  })

  describe('capability gating', () => {
    it('renders during the capability race', () => {
      mockUseCapabilities = { capabilities: null, runtimeName: null }
      render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)
      expect(screen.getByTestId('footer-model')).toBeInTheDocument()
    })

    it('hides when supports_models is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_models: false }),
        runtimeName: 'Goose',
      }
      render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)
      expect(screen.queryByTestId('footer-model')).toBeNull()
    })

    it('hides when supports_set_model_mid_session is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_set_model_mid_session: false }),
        runtimeName: 'Goose',
      }
      render(<ModelPicker currentModel="claude-opus-4-6" disabled={false} />)
      expect(screen.queryByTestId('footer-model')).toBeNull()
    })
  })
})
