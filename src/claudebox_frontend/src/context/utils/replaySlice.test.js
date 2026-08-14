/** Tests for the replay drain's slice-boundary chooser. */

import { describe, expect, it } from 'vitest'
import { replaySliceEnd } from './replaySlice'

const assistant = i => ({ type: 'assistant', content: `a${i}` })
const human = i => ({ type: 'user', is_human: true, content: `h${i}` })
const compactStart = () => ({ type: 'system', subtype: 'compact_start' })
const compactBoundary = () => ({ type: 'system', subtype: 'compact_boundary' })
const postCompactionContext = () => ({ type: 'user', is_human: false, content: 'summary' })
// The backend stamps a block with the type of the message that carried it, so a tool result exists in both shapes.
// Only the assistant-carried one reaches the branch of appendTurns that places the buffered compaction block.
const userToolResult = () => ({ type: 'user', subtype: 'tool_result', is_human: false })
const assistantToolResult = () => ({ type: 'assistant', subtype: 'tool_result' })
const nestedToolResult = () => ({ ...userToolResult(), parent_tool_use_id: 'tu_1' })
const taskNotificationEcho = () => ({
  type: 'user',
  is_human: false,
  content: '<task-notification>done</task-notification>',
})

/** Build a buffer of n plain assistant events. */
function plain(n) {
  return Array.from({ length: n }, (_, i) => assistant(i))
}

describe('replaySliceEnd', () => {
  it('takes the whole buffer when it is shorter than the slice size', () => {
    expect(replaySliceEnd(plain(3), 10, false)).toBe(3)
  })

  it('cuts at the slice size when no compaction run is in flight', () => {
    expect(replaySliceEnd(plain(50), 10, false)).toBe(10)
  })

  it('returns 0 for an empty buffer', () => {
    expect(replaySliceEnd([], 10, true)).toBe(0)
  })

  // A cut between compact_start and the placing event would flush the compaction block into the preceding turn.
  it('extends past the slice size to close an open compaction run', () => {
    const buffer = [...plain(3), compactStart(), compactBoundary(), human(0), assistant(9)]

    // Desired cut is 4 - immediately after compact_start, mid-run.
    expect(replaySliceEnd(buffer, 4, false)).toBe(7)
  })

  it('treats post-compaction context as part of the run', () => {
    const buffer = [compactStart(), compactBoundary(), postCompactionContext(), assistant(0)]

    expect(replaySliceEnd(buffer, 1, false)).toBe(4)
  })

  // appendTurns buffers every non-human user event while a run is open, and a user-carried tool result is one.
  // Cutting after it would flush the compaction block into whatever turn was current at slice end.
  it('keeps the run open across a user-carried tool result', () => {
    const buffer = [compactStart(), compactBoundary(), userToolResult(), assistant(0)]

    expect(replaySliceEnd(buffer, 1, false)).toBe(4)
  })

  it('keeps the run open across a nested tool result', () => {
    const buffer = [compactStart(), compactBoundary(), nestedToolResult(), assistant(0)]

    expect(replaySliceEnd(buffer, 1, false)).toBe(4)
  })

  it('closes the run on an assistant-carried tool result', () => {
    const buffer = [compactStart(), compactBoundary(), assistantToolResult(), human(0)]

    expect(replaySliceEnd(buffer, 1, false)).toBe(3)
  })

  // The reducer walks the visible subset, so an event appendTurns never sees can't place the block.
  it('does not close the run on an event filtered out before appendTurns', () => {
    const buffer = [compactStart(), compactBoundary(), taskNotificationEcho(), assistant(0)]

    expect(replaySliceEnd(buffer, 1, false)).toBe(4)
  })

  // The full divergence this guard prevents: the run opens inside the window, a user-carried tool
  // result sits between it and the placing event, and two turn boundaries follow.
  // Cutting at the slice size would flush the block into the first turn instead of the second, where it belongs.
  it('extends past a tool result that sits between the run and its placing event', () => {
    const buffer = [
      human(0),
      assistant(0),
      compactStart(),
      compactBoundary(),
      userToolResult(),
      human(1),
      human(2),
      assistant(1),
    ]

    expect(replaySliceEnd(buffer, 6, false)).toBe(8)
  })

  it('does not close the run on a human turn boundary', () => {
    const buffer = [compactStart(), compactBoundary(), human(0), human(1), assistant(0)]

    expect(replaySliceEnd(buffer, 1, false)).toBe(5)
  })

  it('treats a boundary without a start as an open run', () => {
    const buffer = [compactBoundary(), postCompactionContext(), assistant(0)]

    expect(replaySliceEnd(buffer, 1, false)).toBe(3)
  })

  // The run's closing event hasn't arrived yet; holding the tail back keeps the run whole for a later slice.
  it('holds an unclosable run back while the server is still sending', () => {
    const buffer = [...plain(3), compactStart(), compactBoundary()]

    expect(replaySliceEnd(buffer, 10, false)).toBe(3)
  })

  it('holds back everything when the run opens at the head of the buffer', () => {
    const buffer = [compactStart(), compactBoundary()]

    expect(replaySliceEnd(buffer, 10, false)).toBe(0)
  })

  // Once the server is done, an unclosed run genuinely ends the transcript; appendTurns flushes it at batch end.
  it('takes an unclosable run once the server has finished sending', () => {
    const buffer = [...plain(3), compactStart(), compactBoundary()]

    expect(replaySliceEnd(buffer, 10, true)).toBe(5)
  })

  it('ignores a run that already closed before the cut', () => {
    const buffer = [compactStart(), compactBoundary(), assistant(0), ...plain(20)]

    expect(replaySliceEnd(buffer, 5, false)).toBe(5)
  })
})
