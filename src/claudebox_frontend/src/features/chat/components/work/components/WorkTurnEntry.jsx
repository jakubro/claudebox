/** One turn's routed-away blocks in the work panel: separator, TurnProvider, blocks. */

import { memo, useMemo } from 'react'
import { BlockType } from '../../../../../config/schema'
import { computeTimingOffsets, processEvents } from '../../../../../utils/eventProcessing'
import TurnSegments from '../../turn/components/TurnSegments'
import { TurnProvider } from '../../turn/TurnContext'
import { groupBlocks } from '../../turn/utils/groupBlocks'
import { getTurnTimeRange } from '../../turn/utils/turnContent'
import { mergeWorkSegments } from '../utils/mergeWorkSegments'

/**
 * `ToolBlock` opens with `useTurn()` unconditionally, so this supplies that provider on the same
 * values `Turn.jsx` gives the transcript. A turn routing nothing away renders nothing here.
 *
 * @param {object} props.turn - The turn this entry belongs to (events, turn_id, interrupted).
 * @param {string} props.mode - TurnRoutingMode; decides which of the turn's blocks route here.
 * @param {object} props.nextMessageInfo - Per-entry {hasNextUserMessage,
 *   nextUserMessageIsFormResponse, nextUserMessage}, read off the neighbouring turn.
 * @param {object} props.sessionScope - {hasPendingMessages, todoDiffs, taskNotifications,
 *   onFormSubmit, registerPendingForm, duplicateAskUserIds}, identical across every entry.
 * @param {number} props.now - Live-ticking clock for a pending async block's duration.
 * @param {boolean} props.isActiveTurn - Whether this is the session's currently-responding turn.
 * @param {Function} [props.onJump] - (turnId) => void - the separator's jump-to-transcript click.
 */
function WorkTurnEntry({
  turn,
  mode,
  nextMessageInfo = {},
  sessionScope = {},
  now,
  isActiveTurn,
  onJump,
}) {
  const blocks = useMemo(() => processEvents(turn.events), [turn.events])
  const { panel } = useMemo(() => groupBlocks(blocks, mode), [blocks, mode])
  const segments = useMemo(() => mergeWorkSegments(blocks, panel), [blocks, panel])
  const { startTime } = useMemo(() => getTurnTimeRange(turn.events), [turn.events])

  const blockOffsets = useMemo(() => {
    const timestamps = segments.map(seg => {
      if (seg.kind !== 'single' || seg.block.type !== BlockType.TOOL) {
        return null
      }
      return seg.block.toolResult?.ts || seg.block.toolUse?.ts
    })
    return computeTimingOffsets(timestamps, startTime)
  }, [segments, startTime])

  if (segments.length === 0) {
    return null
  }

  // Marks only when the turn's trailing block is a TOOL block and is also this entry's last
  // segment, so an interrupt landing on prose or compaction marks nothing here.
  const lastSegment = segments[segments.length - 1]
  const lastSegmentBlock =
    lastSegment.kind === 'todos-group'
      ? lastSegment.blocks[lastSegment.blocks.length - 1]
      : lastSegment.block
  const lastBlockOfTurn = blocks[blocks.length - 1]
  const isTrailingInterrupted =
    !!turn.interrupted &&
    lastSegmentBlock?.type === BlockType.TOOL &&
    lastSegmentBlock === lastBlockOfTurn

  return (
    // A distinct attribute, not `data-turn-id`: callers query that name expecting one match, and
    // this entry shares its turn_id with the transcript's own turn.
    <div
      className="work-turn-entry"
      data-testid="work-turn-entry"
      data-work-turn-id={turn.turn_id ?? ''}>
      <button
        type="button"
        className="work-turn-separator"
        onClick={() => onJump?.(turn.turn_id)}
        title="Jump to this turn in the transcript">
        Turn
      </button>
      <TurnProvider
        {...nextMessageInfo}
        {...sessionScope}
        turnStartTime={startTime}
        now={now}
        isActiveTurn={isActiveTurn}>
        <TurnSegments
          segments={segments}
          blockOffsets={blockOffsets}
          todoDiffs={sessionScope.todoDiffs}
          duplicateAskUserIds={sessionScope.duplicateAskUserIds}
          lastSegmentClassName={isTrailingInterrupted ? 'work-interrupted-block' : null}
        />
      </TurnProvider>
    </div>
  )
}

export default memo(WorkTurnEntry)
