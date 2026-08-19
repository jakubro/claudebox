/** Tests for SwimlaneBand component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveTicket,
  deleteSwimlane,
  renameSwimlane,
  reorderSwimlanes,
} from '../../../api/boards'
import SwimlaneBand from './SwimlaneBand'

vi.mock('../../../api/boards', () => ({
  archiveTicket: vi.fn(),
  deleteSwimlane: vi.fn(),
  renameSwimlane: vi.fn(),
  reorderSwimlanes: vi.fn(),
}))

const defaultProps = {
  lane: { id: 'lane-1', name: 'Sprint 1' },
  boardId: 'board-1',
  refresh: vi.fn(),
  isUnsorted: false,
  swimlaneIds: ['lane-1', 'lane-2'],
  allTickets: { backlog: [{ path: 'tickets/a.md', swimlane: 'lane-1' }] },
}

describe('SwimlaneBand', () => {
  beforeEach(() => {
    defaultProps.refresh.mockClear()
    archiveTicket.mockReset().mockResolvedValue(undefined)
    deleteSwimlane.mockReset().mockResolvedValue(undefined)
    renameSwimlane.mockReset().mockResolvedValue(undefined)
    reorderSwimlanes.mockReset().mockResolvedValue(undefined)
  })

  it('renders lane name', () => {
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    expect(screen.getByText('Sprint 1')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <SwimlaneBand {...defaultProps}>
        <div data-testid="child">column content</div>
      </SwimlaneBand>,
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('enters edit mode on double-click', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.dblClick(screen.getByText('Sprint 1'))

    expect(screen.getByDisplayValue('Sprint 1')).toBeInTheDocument()
  })

  it('does not enter edit mode on double-click for unsorted lane', async () => {
    const user = userEvent.setup()
    render(
      <SwimlaneBand {...defaultProps} isUnsorted>
        cells
      </SwimlaneBand>,
    )

    await user.dblClick(screen.getByText('Sprint 1'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows context menu on right-click', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('Sprint 1'),
    })

    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByText('Move up')).toBeInTheDocument()
    expect(screen.getByText('Move down')).toBeInTheDocument()
  })

  it('does not show context menu on right-click for unsorted lane', async () => {
    const user = userEvent.setup()
    render(
      <SwimlaneBand {...defaultProps} isUnsorted>
        cells
      </SwimlaneBand>,
    )

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('Sprint 1'),
    })

    expect(screen.queryByText('Rename')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  it('hides context menu when backdrop clicked', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('Sprint 1'),
    })
    expect(screen.getByText('Rename')).toBeInTheDocument()

    const backdrop = document.querySelector('.swimlane-context-backdrop')
    await user.click(backdrop)

    expect(screen.queryByText('Rename')).not.toBeInTheDocument()
  })

  it('hides children when collapsed', () => {
    render(
      <SwimlaneBand {...defaultProps} collapsed>
        <div data-testid="child">column content</div>
      </SwimlaneBand>,
    )

    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('renders the drag handle only for a sortable, non-unsorted lane', () => {
    const { rerender } = render(
      <SwimlaneBand {...defaultProps} sortableId="lane-header:lane-1">
        cells
      </SwimlaneBand>,
    )
    expect(document.querySelector('.board-drag-handle')).toBeInTheDocument()

    rerender(
      <SwimlaneBand {...defaultProps} isUnsorted sortableId="lane-header:lane-1">
        cells
      </SwimlaneBand>,
    )
    expect(document.querySelector('.board-drag-handle')).not.toBeInTheDocument()
  })

  it('cancels editing on Escape without submitting', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.dblClick(screen.getByText('Sprint 1'))
    const input = screen.getByDisplayValue('Sprint 1')
    await user.type(input, 'X{Escape}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(renameSwimlane).not.toHaveBeenCalled()
  })

  it('submits a rename on Enter and refreshes', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.dblClick(screen.getByText('Sprint 1'))
    const input = screen.getByDisplayValue('Sprint 1')
    await user.clear(input)
    await user.type(input, 'Sprint 2{Enter}')

    expect(renameSwimlane).toHaveBeenCalledWith('board-1', 'lane-1', 'Sprint 2')
    expect(defaultProps.refresh).toHaveBeenCalled()
  })

  it('submits a rename on blur', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <SwimlaneBand {...defaultProps}>cells</SwimlaneBand>
        <button type="button">elsewhere</button>
      </div>,
    )

    await user.dblClick(screen.getByText('Sprint 1'))
    const input = screen.getByDisplayValue('Sprint 1')
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(screen.getByText('elsewhere'))

    expect(renameSwimlane).toHaveBeenCalledWith('board-1', 'lane-1', 'Renamed')
  })

  it('does not submit a rename when the trimmed name is unchanged or empty', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.dblClick(screen.getByText('Sprint 1'))
    await user.type(screen.getByDisplayValue('Sprint 1'), '{Enter}')
    expect(renameSwimlane).not.toHaveBeenCalled()

    await user.dblClick(screen.getByText('Sprint 1'))
    const input = screen.getByDisplayValue('Sprint 1')
    await user.clear(input)
    await user.type(input, '   {Enter}')
    expect(renameSwimlane).not.toHaveBeenCalled()
  })

  it('logs when renaming fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renameSwimlane.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.dblClick(screen.getByText('Sprint 1'))
    const input = screen.getByDisplayValue('Sprint 1')
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')

    expect(consoleSpy).toHaveBeenCalledWith('Failed to rename swimlane:', expect.any(Error))
  })

  it('opens the editor from the context menu Rename action', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Sprint 1') })
    await user.click(screen.getByText('Rename'))

    expect(screen.getByDisplayValue('Sprint 1')).toBeInTheDocument()
  })

  it('deletes the swimlane and refreshes', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Sprint 1') })
    await user.click(screen.getByText('Delete'))

    expect(deleteSwimlane).toHaveBeenCalledWith('board-1', 'lane-1')
    expect(defaultProps.refresh).toHaveBeenCalled()
  })

  it('logs when deleting fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    deleteSwimlane.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Sprint 1') })
    await user.click(screen.getByText('Delete'))

    expect(consoleSpy).toHaveBeenCalledWith('Failed to delete swimlane:', expect.any(Error))
  })

  it('moves the swimlane down and refreshes', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Sprint 1') })
    await user.click(screen.getByText('Move down'))

    expect(reorderSwimlanes).toHaveBeenCalledWith('board-1', ['lane-2', 'lane-1'])
    expect(defaultProps.refresh).toHaveBeenCalled()
  })

  it('is a no-op moving up past the first position', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Sprint 1') })
    await user.click(screen.getByText('Move up'))

    expect(reorderSwimlanes).not.toHaveBeenCalled()
  })

  it('logs when reordering fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reorderSwimlanes.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Sprint 1') })
    await user.click(screen.getByText('Move down'))

    expect(consoleSpy).toHaveBeenCalledWith('Failed to reorder swimlanes:', expect.any(Error))
  })

  it('bulk-archives every ticket in the lane and refreshes', async () => {
    const user = userEvent.setup()
    render(<SwimlaneBand {...defaultProps}>cells</SwimlaneBand>)

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Sprint 1') })
    expect(
      screen.getByText('Archive all tickets in Sprint 1 swimlane (1 tickets)'),
    ).toBeInTheDocument()
    await user.click(screen.getByText('Archive all tickets in Sprint 1 swimlane (1 tickets)'))

    expect(archiveTicket).toHaveBeenCalledWith('board-1', 'tickets/a.md')
    expect(defaultProps.refresh).toHaveBeenCalled()
  })

  it('disables bulk archive when the lane has no tickets', async () => {
    const user = userEvent.setup()
    render(
      <SwimlaneBand {...defaultProps} lane={{ id: 'lane-2', name: 'Sprint 2' }} allTickets={{}}>
        cells
      </SwimlaneBand>,
    )

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Sprint 2') })

    expect(screen.getByText('Archive all tickets in Sprint 2 swimlane (0 tickets)')).toBeDisabled()
  })
})
