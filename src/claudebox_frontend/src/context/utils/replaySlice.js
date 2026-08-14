/** Slice-boundary chooser for the replay drain - keeps compaction runs whole. */

import { EventSubtype, EventType } from '../../config/schema'
import { isHumanEvent } from '../../utils/eventPredicates'
import { isVisibleEvent } from '../../utils/eventProcessing'

/**
 * Choose how many buffered replay events to materialize in the next slice.
 *
 * Returns a count in [0, buffer.length]; normally `maxSize`, but a cut is never placed inside
 * an open compaction run.
 *
 * Why: `appendTurns` buffers `compact_start` / `compact_boundary` until a later event
 * establishes their turn, then flushes them into the *current* turn at end of batch
 * (`pendingCompactionEvents: null`). A mid-run cut would attach the block to the wrong turn -
 * a grouping change this drain must not cause.
 *
 * When the run can't be closed with the events on hand: hold the tail for a later slice
 * (`serverDone` false) or take it whole (`serverDone` true - the transcript genuinely ends
 * mid-run, a valid terminal state).
 */
export function replaySliceEnd(buffer, maxSize, serverDone) {
  const desired = Math.min(maxSize, buffer.length)
  let openedAt = -1

  for (let i = 0; i < desired; i++) {
    if (opensCompactionRun(buffer[i])) {
      if (openedAt === -1) {
        openedAt = i
      }
    } else if (openedAt !== -1 && closesCompactionRun(buffer[i])) {
      openedAt = -1
    }
  }

  if (openedAt === -1) {
    return desired
  }

  for (let i = desired; i < buffer.length; i++) {
    if (closesCompactionRun(buffer[i])) {
      return i + 1
    }
  }

  return serverDone ? buffer.length : openedAt
}

/** Test whether the event starts (or extends) the buffered compaction run. */
function opensCompactionRun(event) {
  return (
    isVisibleEvent(event) &&
    (event.subtype === EventSubtype.COMPACT_START ||
      event.subtype === EventSubtype.COMPACT_BOUNDARY)
  )
}

/**
 * Test whether the event forces the buffered compaction run to be placed.
 *
 * `appendTurns` flushes the buffer only from the branch a non-compaction event falls through
 * to, and buffers every non-human user event while a run is open. A tool result delivered in a
 * user message is `type: 'user', is_human: false` and gets buffered, not placed - treating it
 * as a closer would reattach the compaction block to the preceding turn.
 *
 * Closers left after that exclusion: assistant events and nested human events. Nested system
 * events also flush in `appendTurns` but are deliberately excluded here - misjudging a closer
 * changes grouping, misjudging a non-closer only defers the tail.
 *
 * Invisible events are skipped: `appendTurns` only walks the `isVisibleEvent` subset, while the
 * cut is chosen over the raw buffer.
 */
function closesCompactionRun(event) {
  if (!isVisibleEvent(event)) {
    return false
  }

  return event.type === EventType.ASSISTANT || (!!event.parent_tool_use_id && isHumanEvent(event))
}
