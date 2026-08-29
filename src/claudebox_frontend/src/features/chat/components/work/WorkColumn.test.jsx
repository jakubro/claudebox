/** Tests for WorkColumn - session-wide work panel, grouped by turn. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isLookupsGroupingEnabled } from '../../../../config/features'
import { TurnRoutingMode } from '../../../../utils/eventProcessing'
import WorkColumn from './WorkColumn'

vi.mock('../../../../config/features', () => ({
  isLookupsGroupingEnabled: vi.fn(),
}))

vi.mock('../turn/components/tool-block', () => ({
  default: props => (
    <div data-testid="tool-block" data-tool-use-id={props.toolUse?.tool_use_id}>
      {props.toolUse?.content}
    </div>
  ),
}))

beforeEach(() => {
  vi.mocked(isLookupsGroupingEnabled).mockReturnValue(false)
})

function toolUseEvent(content, id, input = {}) {
  return { type: 'assistant', subtype: 'tool_use', content, tool_use_id: id, tool_input: input }
}

function turnWithTool(turnId, toolId) {
  return { turn_id: turnId, events: [toolUseEvent('Edit', toolId, { file_path: 'a.js' })] }
}

function turnWithTextOnly(turnId) {
  return { turn_id: turnId, events: [{ type: 'assistant', subtype: 'text', content: 'hi' }] }
}

describe('WorkColumn', () => {
  it('shows the empty state for an empty session', () => {
    render(<WorkColumn turns={[]} mode={TurnRoutingMode.ALL_TOOLS} />)
    expect(screen.getByTestId('work-empty')).toHaveTextContent('No work has happened yet.')
  })

  it('shows the empty state when every turn kept its content in the transcript', () => {
    render(
      <WorkColumn
        turns={[turnWithTextOnly('t1'), turnWithTextOnly('t2')]}
        mode={TurnRoutingMode.ALL_TOOLS}
      />,
    )
    expect(screen.getByTestId('work-empty')).toBeInTheDocument()
  })

  it('renders one entry per turn that routed something away, oldest first', () => {
    render(
      <WorkColumn
        turns={[turnWithTool('t1', 'e-1'), turnWithTextOnly('t2'), turnWithTool('t3', 'e-3')]}
        mode={TurnRoutingMode.ALL_TOOLS}
      />,
    )
    expect(screen.queryByTestId('work-empty')).not.toBeInTheDocument()
    const entries = screen.getAllByTestId('work-turn-entry')
    expect(entries.map(el => el.dataset.workTurnId)).toEqual(['t1', 't3'])
  })

  it('reuses the same ToolBlock component TurnBlockList dispatches to', () => {
    render(<WorkColumn turns={[turnWithTool('t1', 'e-1')]} mode={TurnRoutingMode.ALL_TOOLS} />)
    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-use-id', 'e-1')
  })

  it('forwards a click on the separator to onEntryJump with the turn id', async () => {
    const user = userEvent.setup()
    const onEntryJump = vi.fn()
    render(
      <WorkColumn
        turns={[turnWithTool('t1', 'e-1')]}
        mode={TurnRoutingMode.ALL_TOOLS}
        onEntryJump={onEntryJump}
      />,
    )

    await user.click(screen.getByTitle('Jump to this turn in the transcript'))

    expect(onEntryJump).toHaveBeenCalledWith('t1')
  })

  it('carries a data-index on every entry row, matching its position among all turns', () => {
    const { container } = render(
      <WorkColumn
        turns={[turnWithTool('t1', 'e-1'), turnWithTool('t2', 'e-2')]}
        mode={TurnRoutingMode.ALL_TOOLS}
      />,
    )
    const indexes = [...container.querySelectorAll('[data-index]')].map(el =>
      el.getAttribute('data-index'),
    )
    expect(indexes).toEqual(['0', '1'])
  })

  it('carries the pinned class only when its own pin is set', () => {
    const { rerender, container } = render(
      <WorkColumn turns={[]} mode={TurnRoutingMode.ALL_TOOLS} />,
    )
    expect(container.querySelector('.work-column')).not.toHaveClass('minimap-pinned')

    rerender(<WorkColumn turns={[]} mode={TurnRoutingMode.ALL_TOOLS} minimapPinned={true} />)
    expect(container.querySelector('.work-column')).toHaveClass('minimap-pinned')

    rerender(<WorkColumn turns={[]} mode={TurnRoutingMode.ALL_TOOLS} minimapPinned={false} />)
    expect(container.querySelector('.work-column')).not.toHaveClass('minimap-pinned')
  })

  it('fills virtualizerRef with the work panel virtualizer', () => {
    const virtualizerRef = { current: null }
    render(
      <WorkColumn
        turns={[turnWithTool('t1', 'e-1')]}
        mode={TurnRoutingMode.ALL_TOOLS}
        virtualizerRef={virtualizerRef}
      />,
    )
    expect(virtualizerRef.current).not.toBeNull()
    expect(typeof virtualizerRef.current.scrollToIndex).toBe('function')
  })

  describe('trailing-row growth', () => {
    // @tanstack/virtual-core observes via ResizeObserver too, so the stub tracks targets per
    // instance and picks the one watching the trailing row.
    let instances

    beforeEach(() => {
      instances = []
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb) {
            this.cb = cb
            instances.push(this)
          }
          observe(el) {
            this.target = el
          }
          unobserve() {}
          disconnect() {}
        },
      )
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('re-pins scroll when the last turn resizes in place', () => {
      const scrollToBottom = vi.fn()
      const { container } = render(
        <WorkColumn
          turns={[turnWithTool('t1', 'e-1')]}
          mode={TurnRoutingMode.ALL_TOOLS}
          scrollToBottom={scrollToBottom}
        />,
      )

      const trailingRow = container.querySelector('[data-index="0"]')
      const trailingObserver = instances.find(i => i.target === trailingRow)
      expect(trailingObserver).toBeDefined()

      trailingObserver.cb()

      expect(scrollToBottom).toHaveBeenCalled()
    })

    it('does nothing when no scrollToBottom is supplied - the column still renders correctly', () => {
      expect(() =>
        render(<WorkColumn turns={[turnWithTool('t1', 'e-1')]} mode={TurnRoutingMode.ALL_TOOLS} />),
      ).not.toThrow()
    })
  })
})
