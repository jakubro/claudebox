/** Tests for RightSlotColumns - the wiring between each column's own pin state and its column. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RightSlotColumns from './RightSlotColumns'

vi.mock('./terminal', () => ({
  default: props => (
    <div data-testid="terminal-column-stub" data-minimap-pinned={String(props.minimapPinned)} />
  ),
}))
vi.mock('./work', () => ({
  default: props => (
    <div data-testid="work-column-stub" data-minimap-pinned={String(props.minimapPinned)} />
  ),
}))
vi.mock('./ColumnMinimap', () => ({
  default: () => <div data-testid="column-minimap-stub" />,
}))

function renderColumns(overrides = {}) {
  return render(
    <RightSlotColumns
      showTerminalSplit={true}
      showWorkView={true}
      showReplayOverlay={false}
      isMobile={false}
      terminalEntries={[]}
      turns={[]}
      terminalMinimapPinned={false}
      workMinimapPinned={false}
      {...overrides}
    />,
  )
}

describe('RightSlotColumns', () => {
  it("passes the work column's own pin, not the terminal's, to WorkColumn", () => {
    renderColumns({ workMinimapPinned: true, terminalMinimapPinned: false })

    expect(screen.getByTestId('work-column-stub')).toHaveAttribute('data-minimap-pinned', 'true')
    expect(screen.getByTestId('terminal-column-stub')).toHaveAttribute(
      'data-minimap-pinned',
      'false',
    )
  })

  it("passes the terminal column's own pin, not the work column's, to TerminalColumn", () => {
    renderColumns({ workMinimapPinned: false, terminalMinimapPinned: true })

    expect(screen.getByTestId('terminal-column-stub')).toHaveAttribute(
      'data-minimap-pinned',
      'true',
    )
    expect(screen.getByTestId('work-column-stub')).toHaveAttribute('data-minimap-pinned', 'false')
  })

  it('carries neither pin onto its column on mobile, same as the terminal already does', () => {
    renderColumns({ workMinimapPinned: true, terminalMinimapPinned: true, isMobile: true })

    expect(screen.getByTestId('work-column-stub')).toHaveAttribute('data-minimap-pinned', 'false')
    expect(screen.getByTestId('terminal-column-stub')).toHaveAttribute(
      'data-minimap-pinned',
      'false',
    )
  })
})
