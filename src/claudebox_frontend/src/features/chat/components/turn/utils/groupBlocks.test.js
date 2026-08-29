/** Tests for groupBlocks - task-list run partitioning + inspection-only demote + side split. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isLookupsGroupingEnabled } from '../../../../../config/features'
import { BlockType, ToolName } from '../../../../../config/schema'
import { TurnRoutingMode } from '../../../../../utils/eventProcessing'
import { groupBlocks } from './groupBlocks'

vi.mock('../../../../../config/features', () => ({
  isLookupsGroupingEnabled: vi.fn(),
}))

// Most of this file exercises gather-enabled; the "switch off" describe below overrides to the real default.
beforeEach(() => {
  vi.mocked(isLookupsGroupingEnabled).mockReturnValue(true)
})

/** Make a TOOL block. `partition` is the parent_tool_use_id (null = main agent). */
function toolBlock(content, id, partition = null) {
  return {
    type: BlockType.TOOL,
    toolUse: { content, tool_use_id: id, parent_tool_use_id: partition },
  }
}

/** Make a non-tool block (text / thinking / compaction / interrupt). */
function textBlock(content = 'hi') {
  return { type: BlockType.TEXT, event: { content } }
}

/** Make a ToolSearch block; pass `isError: true` for an errored (still-visible) call. */
function toolSearchBlock(id, { isError } = {}) {
  return {
    type: BlockType.TOOL,
    toolUse: { content: ToolName.TOOL_SEARCH, tool_use_id: id },
    toolResult: isError === undefined ? undefined : { is_error: isError },
  }
}

describe('groupBlocks', () => {
  it('passes through a single non-tool block as a single segment', () => {
    const { transcript: segments } = groupBlocks([textBlock('hello')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('single')
    expect(segments[0].index).toBe(0)
  })

  it('emits a todos-group for a solo TaskCreate', () => {
    const { transcript: segments } = groupBlocks([toolBlock(ToolName.TASK_CREATE, 'tc-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[0].blocks).toHaveLength(1)
  })

  it('emits a todos-group for a solo TaskUpdate', () => {
    const { transcript: segments } = groupBlocks([toolBlock(ToolName.TASK_UPDATE, 'tu-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
  })

  it('demotes a solo TaskList (no mutation) to a single segment', () => {
    const { transcript: segments } = groupBlocks([toolBlock(ToolName.TASK_LIST, 'tl-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('single')
    expect(segments[0].block.toolUse.tool_use_id).toBe('tl-1')
    expect(segments[0].index).toBe(0)
  })

  it('demotes a solo TaskGet (no mutation) to a single segment', () => {
    const { transcript: segments } = groupBlocks([toolBlock(ToolName.TASK_GET, 'tg-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('single')
  })

  it('demotes a run of TaskList + TaskGet (no mutation) to two singles, which then gather', () => {
    // Orphaned read-only singles meet the Lookups gather threshold - see "lookups gather pass" below.
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_GET, 'tg-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('lookups-group')
    expect(segments[0].entries.map(e => e.block.toolUse.tool_use_id)).toEqual(['tl-1', 'tg-1'])
    expect(segments[0].entries.map(e => e.index)).toEqual([0, 1])
  })

  it('groups TaskList + TaskUpdate (mutation present) into one todos-group', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[0].blocks).toHaveLength(2)
  })

  it('groups TaskCreate + TaskList + TaskUpdate (mixed) into one todos-group', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[0].blocks).toHaveLength(3)
  })

  it('breaks a run on a non-task block - group, single, group', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      textBlock('intermission'),
      toolBlock(ToolName.TASK_CREATE, 'tc-2'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['todos-group', 'single', 'todos-group'])
    expect(segments[1].index).toBe(1)
  })

  it('splits the run when parent_tool_use_id changes mid-stream', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1', null),
      toolBlock(ToolName.TASK_CREATE, 'tc-2', 'subagent-X'),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[1].kind).toBe('todos-group')
  })

  it('keeps demoted-inspection indices stable when the run lives between other blocks', () => {
    // blocks[0]=text, blocks[1..2]=inspection-only run (gathers into Lookups), blocks[3]=text.
    const { transcript: segments } = groupBlocks([
      textBlock('a'),
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_GET, 'tg-1'),
      textBlock('b'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['single', 'single', 'lookups-group'])
    expect(segments[0].index).toBe(0)
    expect(segments[1].index).toBe(3)
    expect(segments[2].entries.map(e => e.index)).toEqual([1, 2])
  })

  it('mutation run absorbed across same partition; subsequent inspection-only run demotes', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
      textBlock('break'),
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['todos-group', 'single', 'single'])
    expect(segments[0].blocks).toHaveLength(2)
  })
})

describe('groupBlocks - normalization (LangGraph snake_case)', () => {
  it('groups a solo snake_case task_create the same as TaskCreate', () => {
    const { transcript: segments } = groupBlocks([toolBlock('task_create', 'tc-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
  })

  it('groups snake_case task_list + task_update (mutation present) into one todos-group', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock('task_list', 'tl-1'),
      toolBlock('task_update', 'tu-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[0].blocks).toHaveLength(2)
  })

  it('gathers snake_case read-only tools the same as their PascalCase names', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock('read_file', 'r-1'),
      toolBlock('grep', 'g-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('lookups-group')
    expect(segments[0].entries).toHaveLength(2)
  })
})

describe('groupBlocks - lookups gather pass', () => {
  it('leaves a single read-only block as an ordinary single segment (below threshold)', () => {
    const { transcript: segments } = groupBlocks([toolBlock(ToolName.READ, 'r-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('single')
  })

  it('emits no lookups-group when a turn has no read-only blocks', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.EDIT, 'e-1'),
      toolBlock(ToolName.WRITE, 'w-1'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['single', 'single'])
  })

  it('gathers scattered read-only blocks into one trailing lookups-group, preserving call order', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.READ, 'r-1'),
      toolBlock(ToolName.EDIT, 'e-1'),
      toolBlock(ToolName.GREP, 'g-1'),
      toolBlock(ToolName.WRITE, 'w-1'),
      toolBlock(ToolName.READ, 'r-2'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['single', 'single', 'lookups-group'])
    expect(segments[0].block.toolUse.tool_use_id).toBe('e-1')
    expect(segments[1].block.toolUse.tool_use_id).toBe('w-1')
    const gathered = segments[2]
    expect(gathered.entries.map(e => e.block.toolUse.tool_use_id)).toEqual(['r-1', 'g-1', 'r-2'])
    // Original block indices survive the gather, for per-row timing lookup.
    expect(gathered.entries.map(e => e.index)).toEqual([0, 2, 4])
  })

  it('does not pull a TaskList absorbed into a mutation todos-group into Lookups', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
      toolBlock(ToolName.READ, 'r-1'),
      toolBlock(ToolName.GREP, 'g-1'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['todos-group', 'lookups-group'])
    expect(segments[0].blocks).toHaveLength(3)
    expect(segments[1].entries).toHaveLength(2)
  })

  it('gathers an orphaned TaskList alongside another read-only block', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.READ, 'r-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('lookups-group')
    expect(segments[0].entries.map(e => e.block.toolUse.tool_use_id)).toEqual(['tl-1', 'r-1'])
  })
})

describe('groupBlocks - hidden ToolSearch', () => {
  it('emits nothing for a turn whose only call is a successful ToolSearch', () => {
    const { transcript, panel } = groupBlocks([toolSearchBlock('ts-1')])
    expect(transcript).toEqual([])
    expect(panel).toEqual([])
  })

  it('hides a pending ToolSearch (no result yet) the same as a successful one', () => {
    const { transcript: segments } = groupBlocks([toolSearchBlock('ts-1', { isError: undefined })])
    expect(segments).toEqual([])
  })

  it('keeps an errored ToolSearch visible as an ordinary single', () => {
    const { transcript: segments } = groupBlocks([toolSearchBlock('ts-1', { isError: true })])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('single')
    expect(segments[0].block.toolUse.tool_use_id).toBe('ts-1')
  })

  it('is invisible between two ordinary blocks - neither breaks nor absorbs into either', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.READ, 'r-1'),
      toolSearchBlock('ts-1'),
      toolBlock(ToolName.EDIT, 'e-1'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['single', 'single'])
    expect(segments.map(s => s.block.toolUse.tool_use_id)).toEqual(['r-1', 'e-1'])
  })

  it('does not split or absorb into a Todos run it interrupts', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      toolSearchBlock('ts-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[0].blocks).toHaveLength(2)
  })

  it('hides the LangGraph snake_case tool_search the same as ToolSearch', () => {
    const { transcript: segments } = groupBlocks([toolBlock('tool_search', 'ts-1')])
    expect(segments).toEqual([])
  })
})

describe('groupBlocks - right slot routing', () => {
  it('keeps a top-level Bash block on the transcript by default (mode omitted)', () => {
    const { transcript, panel } = groupBlocks([toolBlock(ToolName.BASH, 'b-1')])
    expect(transcript).toHaveLength(1)
    expect(transcript[0].block.toolUse.tool_use_id).toBe('b-1')
    expect(panel).toEqual([])
  })

  it('moves a top-level Bash block to the panel when the legacy boolean true is passed', () => {
    const { transcript, panel } = groupBlocks([toolBlock(ToolName.BASH, 'b-1')], true)
    expect(transcript).toEqual([])
    expect(panel).toHaveLength(1)
    expect(panel[0].block.toolUse.tool_use_id).toBe('b-1')
  })

  it('moves a LangGraph snake_case bash block the same as Bash', () => {
    const { transcript, panel } = groupBlocks([toolBlock('bash', 'b-1')], true)
    expect(transcript).toEqual([])
    expect(panel).toHaveLength(1)
  })

  it('keeps a nested Bash block (inside a Task) even under BASH_ONLY - stays in its Task block', () => {
    const { transcript, panel } = groupBlocks([toolBlock(ToolName.BASH, 'b-1', 'subagent-X')], true)
    expect(transcript).toHaveLength(1)
    expect(panel).toEqual([])
  })

  it('moves only the top-level Bash between ordinary blocks, leaving the rest on the transcript', () => {
    const { transcript, panel } = groupBlocks(
      [
        toolBlock(ToolName.READ, 'r-1'),
        toolBlock(ToolName.BASH, 'b-1'),
        toolBlock(ToolName.EDIT, 'e-1'),
      ],
      true,
    )
    expect(transcript.map(s => s.kind)).toEqual(['single', 'single'])
    expect(transcript.map(s => s.block.toolUse.tool_use_id)).toEqual(['r-1', 'e-1'])
    expect(panel.map(s => s.block.toolUse.tool_use_id)).toEqual(['b-1'])
  })

  it('still hides a ToolSearch in the same turn regardless of the mode', () => {
    const { transcript, panel } = groupBlocks(
      [toolBlock(ToolName.BASH, 'b-1'), toolSearchBlock('ts-1')],
      true,
    )
    expect(transcript).toEqual([])
    expect(panel).toHaveLength(1)
  })

  it('moves a top-level Bash block to the panel when the mode is BASH_ONLY', () => {
    const { transcript, panel } = groupBlocks(
      [toolBlock(ToolName.BASH, 'b-1')],
      TurnRoutingMode.BASH_ONLY,
    )
    expect(transcript).toEqual([])
    expect(panel).toHaveLength(1)
  })

  it('keeps a top-level Bash block on the transcript when the mode is OFF', () => {
    const { transcript, panel } = groupBlocks(
      [toolBlock(ToolName.BASH, 'b-1')],
      TurnRoutingMode.OFF,
    )
    expect(transcript).toHaveLength(1)
    expect(panel).toEqual([])
  })

  it('under ALL_TOOLS, moves every top-level tool call to the panel, not just Bash', () => {
    const { transcript, panel } = groupBlocks(
      [toolBlock(ToolName.READ, 'r-1'), toolBlock(ToolName.EDIT, 'e-1')],
      TurnRoutingMode.ALL_TOOLS,
    )
    expect(transcript).toEqual([])
    expect(panel.map(s => s.block.toolUse.tool_use_id)).toEqual(['r-1', 'e-1'])
  })

  it('under ALL_TOOLS, text, thinking and compaction segments stay on the transcript', () => {
    const { transcript, panel } = groupBlocks(
      [
        textBlock('hello'),
        { type: BlockType.THINKING, event: { content: 'thinking...' } },
        { type: BlockType.COMPACTION, event: {}, summary: '', isCompacting: false },
        toolBlock(ToolName.EDIT, 'e-1'),
      ],
      TurnRoutingMode.ALL_TOOLS,
    )
    expect(transcript.map(s => s.block.type)).toEqual([
      BlockType.TEXT,
      BlockType.THINKING,
      BlockType.COMPACTION,
    ])
    expect(panel.map(s => s.block.toolUse.tool_use_id)).toEqual(['e-1'])
  })

  it('under ALL_TOOLS, a nested tool call stays on the transcript inside its Task block', () => {
    const { transcript, panel } = groupBlocks(
      [toolBlock(ToolName.BASH, 'b-1', 'subagent-X')],
      TurnRoutingMode.ALL_TOOLS,
    )
    expect(transcript).toHaveLength(1)
    expect(panel).toEqual([])
  })

  it('under ALL_TOOLS, an orphaned top-level Todos run moves whole to the panel, carrying its own index', () => {
    const { transcript, panel } = groupBlocks(
      [toolBlock(ToolName.TASK_CREATE, 'tc-1'), toolBlock(ToolName.TASK_UPDATE, 'tu-1')],
      TurnRoutingMode.ALL_TOOLS,
    )
    expect(transcript).toEqual([])
    expect(panel).toHaveLength(1)
    expect(panel[0].kind).toBe('todos-group')
    expect(panel[0].blocks).toHaveLength(2)
    expect(panel[0].index).toBe(0)
  })

  it('under ALL_TOOLS, the Lookups gather never runs on the panel side', () => {
    vi.mocked(isLookupsGroupingEnabled).mockReturnValue(true)
    const { panel } = groupBlocks(
      [toolBlock(ToolName.READ, 'r-1'), toolBlock(ToolName.GREP, 'g-1')],
      TurnRoutingMode.ALL_TOOLS,
    )
    expect(panel.map(s => s.kind)).toEqual(['single', 'single'])
  })
})

describe('groupBlocks - lookups gather pass (switch off)', () => {
  beforeEach(() => {
    vi.mocked(isLookupsGroupingEnabled).mockReturnValue(false)
  })

  it('never gathers, however many read-only blocks a turn has', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.READ, 'r-1'),
      toolBlock(ToolName.EDIT, 'e-1'),
      toolBlock(ToolName.GREP, 'g-1'),
      toolBlock(ToolName.WRITE, 'w-1'),
      toolBlock(ToolName.READ, 'r-2'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['single', 'single', 'single', 'single', 'single'])
    expect(segments.map(s => s.block.toolUse.tool_use_id)).toEqual([
      'r-1',
      'e-1',
      'g-1',
      'w-1',
      'r-2',
    ])
  })

  it('still groups a mutation-bearing Todos run', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
  })

  it('demotes an inspection-only Todos run to ordinary singles instead of gathering it', () => {
    const { transcript: segments } = groupBlocks([
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_GET, 'tg-1'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['single', 'single'])
  })
})
