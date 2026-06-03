/** Tests for AddSwimlaneRow component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createSwimlane } from '../../../api/boards'
import AddSwimlaneRow from './AddSwimlaneRow'

vi.mock('../../../api/boards', () => ({
  createSwimlane: vi.fn(),
}))

const defaultProps = {
  boardId: 'board-1',
  refresh: vi.fn(),
}

describe('AddSwimlaneRow', () => {
  beforeEach(() => {
    defaultProps.refresh.mockClear()
    vi.mocked(createSwimlane).mockClear()
  })

  it('renders add button initially', () => {
    render(<AddSwimlaneRow {...defaultProps} />)

    expect(screen.getByText('+ Add swimlane')).toBeInTheDocument()
  })

  it('shows input when add button clicked', async () => {
    const user = userEvent.setup()
    render(<AddSwimlaneRow {...defaultProps} />)

    await user.click(screen.getByText('+ Add swimlane'))

    expect(screen.getByPlaceholderText('Swimlane name...')).toBeInTheDocument()
  })

  it('calls createSwimlane on Enter with trimmed name', async () => {
    const user = userEvent.setup()
    vi.mocked(createSwimlane).mockResolvedValue()
    render(<AddSwimlaneRow {...defaultProps} />)

    await user.click(screen.getByText('+ Add swimlane'))
    const input = screen.getByPlaceholderText('Swimlane name...')
    await user.type(input, '  New Lane  {Enter}')

    expect(createSwimlane).toHaveBeenCalledWith('board-1', 'New Lane')
  })

  it('cancels on Escape', async () => {
    const user = userEvent.setup()
    render(<AddSwimlaneRow {...defaultProps} />)

    await user.click(screen.getByText('+ Add swimlane'))
    expect(screen.getByPlaceholderText('Swimlane name...')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByPlaceholderText('Swimlane name...')).not.toBeInTheDocument()
    expect(screen.getByText('+ Add swimlane')).toBeInTheDocument()
  })

  it('does not create swimlane with empty name', async () => {
    const user = userEvent.setup()
    render(<AddSwimlaneRow {...defaultProps} />)

    await user.click(screen.getByText('+ Add swimlane'))
    const input = screen.getByPlaceholderText('Swimlane name...')
    await user.type(input, '   {Enter}')

    expect(createSwimlane).not.toHaveBeenCalled()
  })
})
