/** Tests for TurnBlockList - segment dispatch to the right block renderer. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isLookupsGroupingEnabled } from '../../../../../config/features'
import { BlockType, ToolName } from '../../../../../config/schema'
import { TurnRoutingMode } from '../../../../../utils/eventProcessing'
import { TurnRoutingContext } from '../TurnRoutingContext'
import TurnBlockList from './TurnBlockList'

vi.mock('../../../../../config/features', () => ({
  isLookupsGroupingEnabled: vi.fn(),
}))

vi.mock('../../../../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}))

vi.mock('../../../../../components/CopyButton.jsx', () => ({
  default: () => null,
}))

vi.mock('./ThinkingBlock', () => ({
  default: () => <div data-testid="thinking-block" />,
}))

vi.mock('./CompactionBlock', () => ({
  default: () => <div data-testid="compaction-block" />,
}))

vi.mock('./tool-block', () => ({
  default: props => <div data-testid="tool-block" data-tool-use-id={props.toolUse?.tool_use_id} />,
}))

vi.mock('./tool-block/components/tool-block-expanded-content/components/TodosGroup', () => ({
  default: props => <div data-testid="todos-group" data-count={props.taskBlocks.length} />,
}))

vi.mock('./tool-block/components/tool-block-expanded-content/components/LookupsGroup', () => ({
  default: props => <div data-testid="lookups-group" data-count={props.entries.length} />,
}))

// Most tests run with lookups-grouping enabled; the "switch off" tests below use the real default.
beforeEach(() => {
  vi.mocked(isLookupsGroupingEnabled).mockReturnValue(true)
})

function toolBlock(content, id) {
  return { type: BlockType.TOOL, toolUse: { content, tool_use_id: id } }
}

function textBlock(content = 'hi') {
  return { type: BlockType.TEXT, event: { content } }
}

describe('TurnBlockList', () => {
  it('dispatches a TOOL block to ToolBlock unchanged when there is no grouping', () => {
    render(<TurnBlockList blocks={[toolBlock(ToolName.EDIT, 'e-1')]} blockOffsets={[]} />)

    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-use-id', 'e-1')
    expect(screen.queryByTestId('lookups-group')).not.toBeInTheDocument()
    expect(screen.queryByTestId('todos-group')).not.toBeInTheDocument()
  })

  it('dispatches a todos-group segment to TodosGroup', () => {
    render(
      <TurnBlockList
        blocks={[toolBlock(ToolName.TASK_CREATE, 'tc-1'), toolBlock(ToolName.TASK_UPDATE, 'tu-1')]}
        blockOffsets={[]}
      />,
    )

    expect(screen.getByTestId('todos-group')).toHaveAttribute('data-count', '2')
  })

  it('dispatches a lookups-group segment to LookupsGroup', () => {
    render(
      <TurnBlockList
        blocks={[toolBlock(ToolName.READ, 'r-1'), toolBlock(ToolName.GREP, 'g-1')]}
        blockOffsets={[]}
      />,
    )

    expect(screen.getByTestId('lookups-group')).toHaveAttribute('data-count', '2')
    expect(screen.queryByTestId('tool-block')).not.toBeInTheDocument()
  })

  it('renders a mixed turn: prose and mutations stay in place, lookups gather at the end', () => {
    render(
      <TurnBlockList
        blocks={[
          textBlock('Let me check the config and fix it.'),
          toolBlock(ToolName.READ, 'r-1'),
          toolBlock(ToolName.EDIT, 'e-1'),
          toolBlock(ToolName.GREP, 'g-1'),
        ]}
        blockOffsets={[]}
      />,
    )

    const rendered = screen.getAllByTestId(/markdown|tool-block|lookups-group/)
    expect(rendered.map(el => el.dataset.testid)).toEqual([
      'markdown',
      'tool-block',
      'lookups-group',
    ])
    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-use-id', 'e-1')
    expect(screen.getByTestId('lookups-group')).toHaveAttribute('data-count', '2')
  })

  it('drops a top-level Bash block when TurnRoutingContext is true (legacy boolean)', () => {
    render(
      <TurnRoutingContext.Provider value={true}>
        <TurnBlockList blocks={[toolBlock(ToolName.BASH, 'b-1')]} blockOffsets={[]} />
      </TurnRoutingContext.Provider>,
    )

    expect(screen.queryByTestId('tool-block')).not.toBeInTheDocument()
  })

  it('drops a top-level Bash block when TurnRoutingContext is BASH_ONLY', () => {
    render(
      <TurnRoutingContext.Provider value={TurnRoutingMode.BASH_ONLY}>
        <TurnBlockList blocks={[toolBlock(ToolName.BASH, 'b-1')]} blockOffsets={[]} />
      </TurnRoutingContext.Provider>,
    )

    expect(screen.queryByTestId('tool-block')).not.toBeInTheDocument()
  })

  it('keeps a top-level Bash block by default (no provider)', () => {
    render(<TurnBlockList blocks={[toolBlock(ToolName.BASH, 'b-1')]} blockOffsets={[]} />)

    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-use-id', 'b-1')
  })

  it('with the gather disabled (default), read-only blocks dispatch to ToolBlock individually, never LookupsGroup', () => {
    vi.mocked(isLookupsGroupingEnabled).mockReturnValue(false)
    render(
      <TurnBlockList
        blocks={[toolBlock(ToolName.READ, 'r-1'), toolBlock(ToolName.GREP, 'g-1')]}
        blockOffsets={[]}
      />,
    )

    expect(screen.queryByTestId('lookups-group')).not.toBeInTheDocument()
    const toolBlocks = screen.getAllByTestId('tool-block')
    expect(toolBlocks.map(el => el.dataset.toolUseId)).toEqual(['r-1', 'g-1'])
  })

  it('dispatches a THINKING block to ThinkingBlock and a COMPACTION block to CompactionBlock', () => {
    render(
      <TurnBlockList
        blocks={[
          { type: BlockType.THINKING, event: {} },
          { type: BlockType.COMPACTION, event: {}, summary: '', isCompacting: false },
        ]}
        blockOffsets={[]}
      />,
    )

    expect(screen.getByTestId('thinking-block')).toBeInTheDocument()
    expect(screen.getByTestId('compaction-block')).toBeInTheDocument()
  })
})
