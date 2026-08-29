/** Tests for WorkTurnEntry - per-turn dispatch of a turn's routed-away blocks. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isLookupsGroupingEnabled } from '../../../../../config/features'
import { TurnRoutingMode } from '../../../../../utils/eventProcessing'
import WorkTurnEntry from './WorkTurnEntry'

vi.mock('../../../../../config/features', () => ({
  isLookupsGroupingEnabled: vi.fn(),
}))

vi.mock('../../turn/components/tool-block', async () => {
  const { useTurn } = await import('../../turn/hooks/useTurn')
  return {
    default: props => {
      const { hasNextUserMessage } = useTurn()
      return (
        <div
          data-testid="tool-block"
          data-tool-use-id={props.toolUse?.tool_use_id}
          data-has-next-user-message={String(hasNextUserMessage)}>
          {props.toolUse?.content}
        </div>
      )
    },
  }
})

vi.mock(
  '../../turn/components/tool-block/components/tool-block-expanded-content/components/TodosGroup',
  () => ({
    default: props => <div data-testid="todos-group" data-count={props.taskBlocks.length} />,
  }),
)

vi.mock('../../turn/components/CompactionBlock', () => ({
  default: () => <div data-testid="compaction-block" />,
}))

beforeEach(() => {
  vi.mocked(isLookupsGroupingEnabled).mockReturnValue(false)
})

function toolUseEvent(content, id, input = {}, extra = {}) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content,
    tool_use_id: id,
    tool_input: input,
    ts: '2024-01-01T00:00:00Z',
    ...extra,
  }
}

function toolResultEvent(id, extra = {}) {
  return {
    type: 'user',
    subtype: 'tool_result',
    tool_use_id: id,
    ts: '2024-01-01T00:00:01Z',
    ...extra,
  }
}

describe('WorkTurnEntry', () => {
  it('renders nothing for a turn that routed nothing away', () => {
    const turn = { turn_id: 't1', events: [{ type: 'assistant', subtype: 'text', content: 'hi' }] }
    const { container } = render(<WorkTurnEntry turn={turn} mode={TurnRoutingMode.ALL_TOOLS} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a separator and the routed-away tool block', () => {
    const turn = { turn_id: 't1', events: [toolUseEvent('Edit', 'e-1', { file_path: 'a.js' })] }
    render(<WorkTurnEntry turn={turn} mode={TurnRoutingMode.ALL_TOOLS} />)
    expect(screen.getByTestId('work-turn-entry')).toHaveAttribute('data-work-turn-id', 't1')
    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-use-id', 'e-1')
  })

  it('excludes a nested (subagent) call - it stays inside its own Task block, not listed separately', () => {
    const turn = {
      turn_id: 't1',
      events: [
        toolUseEvent('Task', 'task-1', { description: 'do it' }),
        toolUseEvent('Read', 'r-1', { file_path: 'a.js' }, { parent_tool_use_id: 'task-1' }),
      ],
    }
    render(<WorkTurnEntry turn={turn} mode={TurnRoutingMode.ALL_TOOLS} />)
    const blocks = screen.getAllByTestId('tool-block')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toHaveAttribute('data-tool-use-id', 'task-1')
  })

  it('renders the compaction marker alongside a routed-away tool call', () => {
    const turn = {
      turn_id: 't1',
      events: [
        toolUseEvent('Edit', 'e-1', { file_path: 'a.js' }),
        { type: 'system', subtype: 'compact_boundary', id: 'cb-1', message_data: {} },
      ],
    }
    render(<WorkTurnEntry turn={turn} mode={TurnRoutingMode.ALL_TOOLS} />)
    expect(screen.getByTestId('tool-block')).toBeInTheDocument()
    expect(screen.getByTestId('compaction-block')).toBeInTheDocument()
  })

  it("marks the trailing block when the turn is interrupted and it is the turn's own last block", () => {
    const turn = {
      turn_id: 't1',
      interrupted: true,
      events: [toolUseEvent('Bash', 'b-1', { command: 'ls' })],
    }
    render(<WorkTurnEntry turn={turn} mode={TurnRoutingMode.ALL_TOOLS} />)
    const wrapped = document.querySelector('.work-interrupted-block')
    expect(wrapped).toBeInTheDocument()
    expect(wrapped.querySelector('[data-testid="tool-block"]')).toHaveAttribute(
      'data-tool-use-id',
      'b-1',
    )
  })

  it("marks nothing when the interrupted turn's trailing block is text, not a tool call", () => {
    const turn = {
      turn_id: 't1',
      interrupted: true,
      events: [
        toolUseEvent('Edit', 'e-1', { file_path: 'a.js' }),
        { type: 'assistant', subtype: 'text', content: 'done editing' },
      ],
    }
    render(<WorkTurnEntry turn={turn} mode={TurnRoutingMode.ALL_TOOLS} />)
    expect(document.querySelector('.work-interrupted-block')).not.toBeInTheDocument()
  })

  it('marks nothing for an interrupted turn with no tool calls at all', () => {
    const turn = {
      turn_id: 't1',
      interrupted: true,
      events: [{ type: 'assistant', subtype: 'text', content: 'no tools here' }],
    }
    const { container } = render(<WorkTurnEntry turn={turn} mode={TurnRoutingMode.ALL_TOOLS} />)
    expect(container.firstChild).toBeNull()
  })

  it('does not mark a non-trailing routed block even when the turn is interrupted', () => {
    const turn = {
      turn_id: 't1',
      interrupted: true,
      events: [
        toolUseEvent('Edit', 'e-1', { file_path: 'a.js' }),
        toolUseEvent('Read', 'r-1', { file_path: 'b.js' }),
        { type: 'assistant', subtype: 'text', content: 'wrapping up' },
      ],
    }
    render(<WorkTurnEntry turn={turn} mode={TurnRoutingMode.ALL_TOOLS} />)
    expect(document.querySelector('.work-interrupted-block')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('tool-block')).toHaveLength(2)
  })

  it('threads hasNextUserMessage into the turn provider - useInteractiveState reads it to render an answered AskUserQuestion as answered rather than awaiting', () => {
    const turn = {
      turn_id: 't1',
      events: [
        toolUseEvent('AskUserQuestion', 'ask-1', {
          questions: [{ header: 'Pick', question: 'Pick one', options: ['a', 'b'] }],
        }),
        toolResultEvent('ask-1'),
      ],
    }
    render(
      <WorkTurnEntry
        turn={turn}
        mode={TurnRoutingMode.ALL_TOOLS}
        nextMessageInfo={{
          hasNextUserMessage: true,
          nextUserMessage: '<response:AskUserQuestion>a</response:AskUserQuestion>',
          nextUserMessageIsFormResponse: true,
        }}
      />,
    )
    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-has-next-user-message', 'true')
  })

  it('hides a tool block whose id is in sessionScope.duplicateAskUserIds, same as the transcript', () => {
    const questions = [{ question: 'Pick color?', options: ['red', 'blue'] }]
    const turn = {
      turn_id: 't1',
      events: [
        toolUseEvent('AskUserQuestion', 'tu-ask-1', { questions }),
        toolResultEvent('tu-ask-1'),
        toolUseEvent('AskUserQuestion', 'tu-ask-2', { questions }),
        toolResultEvent('tu-ask-2'),
      ],
    }
    render(
      <WorkTurnEntry
        turn={turn}
        mode={TurnRoutingMode.ALL_TOOLS}
        sessionScope={{ duplicateAskUserIds: new Set(['tu-ask-1']) }}
      />,
    )
    const blocks = screen.getAllByTestId('tool-block')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toHaveAttribute('data-tool-use-id', 'tu-ask-2')
  })
})
