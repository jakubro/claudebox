/** Tests for ConfirmStopModal component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ConfirmStopModal from './ConfirmStopModal.jsx'

describe('ConfirmStopModal', () => {
  it('renders title and stop-variant detail by default', () => {
    render(<ConfirmStopModal onConfirm={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByTestId('confirm-stop-modal')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-stop-modal-title')).toHaveTextContent('Claude is working')
    expect(screen.getByTestId('confirm-stop-modal-detail')).toHaveTextContent(
      'Stopping the session will end the response. Continue?',
    )
  })

  it('renders reload-variant detail when variant="reload"', () => {
    render(<ConfirmStopModal variant="reload" onConfirm={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByTestId('confirm-stop-modal-detail')).toHaveTextContent(
      'Reloading will end the response. Continue?',
    )
  })

  it('falls back to stop detail for unknown variant', () => {
    render(<ConfirmStopModal variant="other" onConfirm={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByTestId('confirm-stop-modal-detail')).toHaveTextContent(
      'Stopping the session will end the response. Continue?',
    )
  })

  it('calls onConfirm when Continue is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<ConfirmStopModal onConfirm={onConfirm} onCancel={vi.fn()} />)

    await user.click(screen.getByTestId('confirm-stop-modal-confirm'))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(<ConfirmStopModal onConfirm={vi.fn()} onCancel={onCancel} />)

    await user.click(screen.getByTestId('confirm-stop-modal-cancel'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when overlay is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    const { container } = render(<ConfirmStopModal onConfirm={vi.fn()} onCancel={onCancel} />)

    await user.click(container.querySelector('.confirm-stop-overlay'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel when modal body is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(<ConfirmStopModal onConfirm={vi.fn()} onCancel={onCancel} />)

    await user.click(screen.getByTestId('confirm-stop-modal'))

    expect(onCancel).not.toHaveBeenCalled()
  })
})
