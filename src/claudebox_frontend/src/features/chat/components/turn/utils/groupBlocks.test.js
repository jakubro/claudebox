/** Tests for groupBlocks — task-list run partitioning + inspection-only demote. */

import { describe, expect, it } from 'vitest'
import { BlockType, ToolName } from '../../../../../config/schema'
import { groupBlocks } from './groupBlocks'

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

describe('groupBlocks', () => {
  it('passes through a single non-tool block as a single segment', () => {
    const segments = groupBlocks([textBlock('hello')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('single')
    expect(segments[0].index).toBe(0)
  })

  it('emits a todos-group for a solo TaskCreate', () => {
    const segments = groupBlocks([toolBlock(ToolName.TASK_CREATE, 'tc-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[0].blocks).toHaveLength(1)
  })

  it('emits a todos-group for a solo TaskUpdate', () => {
    const segments = groupBlocks([toolBlock(ToolName.TASK_UPDATE, 'tu-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
  })

  it('demotes a solo TaskList (no mutation) to a single segment', () => {
    const segments = groupBlocks([toolBlock(ToolName.TASK_LIST, 'tl-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('single')
    expect(segments[0].block.toolUse.tool_use_id).toBe('tl-1')
    expect(segments[0].index).toBe(0)
  })

  it('demotes a solo TaskGet (no mutation) to a single segment', () => {
    const segments = groupBlocks([toolBlock(ToolName.TASK_GET, 'tg-1')])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('single')
  })

  it('demotes a run of TaskList + TaskGet (no mutation) to two singles', () => {
    const segments = groupBlocks([
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_GET, 'tg-1'),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[0].kind).toBe('single')
    expect(segments[1].kind).toBe('single')
    expect(segments[0].block.toolUse.tool_use_id).toBe('tl-1')
    expect(segments[1].block.toolUse.tool_use_id).toBe('tg-1')
    // Indices preserved from the original blocks array.
    expect(segments[0].index).toBe(0)
    expect(segments[1].index).toBe(1)
  })

  it('groups TaskList + TaskUpdate (mutation present) into one todos-group', () => {
    const segments = groupBlocks([
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[0].blocks).toHaveLength(2)
  })

  it('groups TaskCreate + TaskList + TaskUpdate (mixed) into one todos-group', () => {
    const segments = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[0].blocks).toHaveLength(3)
  })

  it('breaks a run on a non-task block — group, single, group', () => {
    const segments = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      textBlock('intermission'),
      toolBlock(ToolName.TASK_CREATE, 'tc-2'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['todos-group', 'single', 'todos-group'])
    expect(segments[1].index).toBe(1)
  })

  it('splits the run when parent_tool_use_id changes mid-stream', () => {
    const segments = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1', null),
      toolBlock(ToolName.TASK_CREATE, 'tc-2', 'subagent-X'),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[0].kind).toBe('todos-group')
    expect(segments[1].kind).toBe('todos-group')
  })

  it('keeps demoted-inspection indices stable when the run lives between other blocks', () => {
    // blocks[0] = text, blocks[1..2] = inspection-only run, blocks[3] = text.
    const segments = groupBlocks([
      textBlock('a'),
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
      toolBlock(ToolName.TASK_GET, 'tg-1'),
      textBlock('b'),
    ])
    expect(segments).toHaveLength(4)
    expect(segments.map(s => s.kind)).toEqual(['single', 'single', 'single', 'single'])
    expect(segments.map(s => s.index)).toEqual([0, 1, 2, 3])
  })

  it('mutation run absorbed across same partition; subsequent inspection-only run demotes', () => {
    const segments = groupBlocks([
      toolBlock(ToolName.TASK_CREATE, 'tc-1'),
      toolBlock(ToolName.TASK_UPDATE, 'tu-1'),
      textBlock('break'),
      toolBlock(ToolName.TASK_LIST, 'tl-1'),
    ])
    expect(segments.map(s => s.kind)).toEqual(['todos-group', 'single', 'single'])
    expect(segments[0].blocks).toHaveLength(2)
  })
})
