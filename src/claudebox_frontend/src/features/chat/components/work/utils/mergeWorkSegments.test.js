/** Tests for mergeWorkSegments. */

import { describe, expect, it } from 'vitest'
import { BlockType } from '../../../../../config/schema'
import { mergeWorkSegments } from './mergeWorkSegments'

function toolBlock(id) {
  return { type: BlockType.TOOL, toolUse: { tool_use_id: id } }
}

function compactionBlock() {
  return { type: BlockType.COMPACTION, event: {}, summary: [], isCompacting: false }
}

function textBlock() {
  return { type: BlockType.TEXT, event: { content: 'hi' } }
}

describe('mergeWorkSegments', () => {
  it('returns the panel segments unchanged when the turn has no compaction', () => {
    const blocks = [toolBlock('e-1')]
    const panelSegments = [{ kind: 'single', block: blocks[0], index: 0 }]
    expect(mergeWorkSegments(blocks, panelSegments)).toBe(panelSegments)
  })

  it('appends a solo compaction segment when the panel side is otherwise empty', () => {
    const blocks = [compactionBlock()]
    const merged = mergeWorkSegments(blocks, [])
    expect(merged).toHaveLength(1)
    expect(merged[0].block.type).toBe(BlockType.COMPACTION)
    expect(merged[0].index).toBe(0)
  })

  it('interleaves a compaction block at its original position among panel tool segments', () => {
    // blocks[0]=tool (panel), blocks[1]=text (transcript-only, not in panelSegments),
    // blocks[2]=compaction (transcript-only per groupBlocks, merged back in here).
    const blocks = [toolBlock('e-1'), textBlock(), compactionBlock()]
    const panelSegments = [{ kind: 'single', block: blocks[0], index: 0 }]

    const merged = mergeWorkSegments(blocks, panelSegments)

    expect(merged.map(s => s.block.type)).toEqual([BlockType.TOOL, BlockType.COMPACTION])
    expect(merged.map(s => s.index)).toEqual([0, 2])
  })

  it('sorts a compaction block ahead of a later panel tool segment', () => {
    const blocks = [compactionBlock(), toolBlock('e-1')]
    const panelSegments = [{ kind: 'single', block: blocks[1], index: 1 }]

    const merged = mergeWorkSegments(blocks, panelSegments)

    expect(merged.map(s => s.block.type)).toEqual([BlockType.COMPACTION, BlockType.TOOL])
  })

  it('merges a todos-group segment (carrying its own index) against a later compaction', () => {
    const blocks = [toolBlock('tc-1'), toolBlock('tu-1'), compactionBlock()]
    const panelSegments = [{ kind: 'todos-group', blocks: [blocks[0], blocks[1]], index: 0 }]

    const merged = mergeWorkSegments(blocks, panelSegments)

    expect(merged.map(s => s.kind)).toEqual(['todos-group', 'single'])
    expect(merged[1].block.type).toBe(BlockType.COMPACTION)
  })
})
