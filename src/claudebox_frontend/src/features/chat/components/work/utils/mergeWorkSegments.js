/** Merge a turn's panel-side segments with its compaction blocks, in call order. */

import { BlockType } from '../../../../../config/schema'

/**
 * `groupBlocks`'s panel side never carries a compaction segment, since only tool blocks leave the
 * transcript. This pulls them from the turn's `blocks` and merges them in by original index.
 */
export function mergeWorkSegments(blocks, panelSegments) {
  const compactionSegments = []
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === BlockType.COMPACTION) {
      compactionSegments.push({ kind: 'single', block: blocks[i], index: i })
    }
  }
  if (compactionSegments.length === 0) {
    return panelSegments
  }
  return [...panelSegments, ...compactionSegments].sort((a, b) => a.index - b.index)
}
