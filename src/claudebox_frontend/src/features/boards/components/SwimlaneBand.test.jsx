/** Tests for SwimlaneBand component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SwimlaneBand from './SwimlaneBand'

vi.mock('../../../api/boards', () => ({
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
}

describe('SwimlaneBand', () => {
  beforeEach(() => {
    defaultProps.refresh.mockClear()
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
})
