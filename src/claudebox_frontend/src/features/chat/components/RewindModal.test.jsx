/** Tests for RewindModal. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import RewindModal from './RewindModal'

describe('RewindModal', () => {
  const defaultProps = {
    mode: 'fork-here',
    forkAll: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders per-turn fork-here title', () => {
    render(<RewindModal {...defaultProps} mode="fork-here" />)

    expect(screen.getByText('Rewind here?')).toBeInTheDocument()
    expect(screen.getByText(/in the same container/)).toBeInTheDocument()
  })

  it('renders per-turn fork-browser-tab title', () => {
    render(<RewindModal {...defaultProps} mode="fork-browser-tab" />)

    expect(screen.getByText('Rewind in new browser tab?')).toBeInTheDocument()
    expect(screen.getByText(/opens it in a new browser tab/)).toBeInTheDocument()
  })

  it('renders fork-all fork-here title (whole-session)', () => {
    render(<RewindModal {...defaultProps} forkAll={true} mode="fork-here" />)

    expect(screen.getByText('Fork here?')).toBeInTheDocument()
  })

  it('renders fork-all fork-browser-tab title (whole-session)', () => {
    render(<RewindModal {...defaultProps} forkAll={true} mode="fork-browser-tab" />)

    expect(screen.getByText('Fork in new browser tab?')).toBeInTheDocument()
  })

  it('falls back to generic title for unknown mode', () => {
    render(<RewindModal {...defaultProps} mode="unknown-mode" />)

    expect(screen.getByText('Rewind to this message?')).toBeInTheDocument()
  })

  it('calls onConfirm when confirm clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<RewindModal {...defaultProps} onConfirm={onConfirm} />)

    await user.click(screen.getByText('Confirm'))

    expect(onConfirm).toHaveBeenCalled()
  })

  it('calls onCancel when cancel clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<RewindModal {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByText('Cancel'))

    expect(onCancel).toHaveBeenCalled()
  })

  it('shows spinner and disables buttons when forking', () => {
    render(<RewindModal {...defaultProps} forking={true} />)

    const confirmBtn = screen.getByRole('button', { name: '' })
    const cancelBtn = screen.getByText('Cancel')
    expect(confirmBtn).toBeDisabled()
    expect(cancelBtn).toBeDisabled()
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument()
  })

  it('does not call onCancel on overlay click when forking', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { container } = render(
      <RewindModal {...defaultProps} forking={true} onCancel={onCancel} />,
    )

    await user.click(container.querySelector('.rewind-overlay'))

    expect(onCancel).not.toHaveBeenCalled()
  })
})
