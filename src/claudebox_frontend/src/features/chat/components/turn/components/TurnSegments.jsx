/** Shared per-segment block dispatch - reused by the transcript and the work panel. */

import CopyButton from '../../../../../components/CopyButton.jsx'
import Markdown from '../../../../../components/Markdown'
import { BlockType } from '../../../../../config/schema'
import CompactionBlock from './CompactionBlock'
import LocalCommandBlock from './LocalCommandBlock'
import SystemReminders from './SystemReminders'
import ThinkingBlock from './ThinkingBlock'
import ToolBlock from './tool-block'
import LookupsGroup from './tool-block/components/tool-block-expanded-content/components/LookupsGroup'
import TodosGroup from './tool-block/components/tool-block-expanded-content/components/TodosGroup'
import { extractSystemReminders } from './tool-block/utils/toolResultFormatters'

/**
 * Renders one turn's segments (from `groupBlocks`) into their block components. Both the transcript
 * and the work panel dispatch through this, so a Bash call renders identically wherever it lands.
 *
 * @param {Array} props.segments - Segments from `groupBlocks` (transcript or panel side).
 * @param {Array} props.blockOffsets - Per-block timing offsets, indexed like `segments`.
 * @param {string} [props.lastSegmentClassName] - Wraps the last rendered segment in this class.
 */
export default function TurnSegments({
  segments,
  blockOffsets,
  duplicateAskUserIds = null,
  todoDiffs = null,
  lastSegmentClassName = null,
}) {
  const rendered = segments.map((segment, segIdx) => {
    if (segment.kind === 'todos-group') {
      return (
        <TodosGroup
          key={`tg-${segIdx}`}
          taskBlocks={segment.blocks.map(b => ({
            toolUseId: b.toolUse?.tool_use_id,
            toolUse: b.toolUse,
          }))}
        />
      )
    }
    if (segment.kind === 'lookups-group') {
      return (
        <LookupsGroup key={`lg-${segIdx}`} entries={segment.entries} blockOffsets={blockOffsets} />
      )
    }
    const { block, index: i } = segment
    if (block.type === BlockType.TEXT) {
      const { content: cleanedContent, reminders } = extractSystemReminders(block.event.content)
      const cmdMatch = cleanedContent.match(
        /^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/,
      )
      return (
        <div key={i} className="turn-text">
          {cmdMatch ? (
            <LocalCommandBlock type={cmdMatch[1]} content={cmdMatch[2].trim()} />
          ) : (
            <Markdown>{cleanedContent}</Markdown>
          )}
          <CopyButton
            text={cleanedContent}
            className="turn-text-copy-btn"
            title="Copy message"
            size={12}
          />
          {reminders.length > 0 && <SystemReminders reminders={reminders} />}
        </div>
      )
    }
    if (block.type === BlockType.THINKING) {
      return <ThinkingBlock key={i} event={block.event} blockRelativeTime={blockOffsets[i]} />
    }
    if (block.type === BlockType.TOOL) {
      const toolUseId = block.toolUse?.tool_use_id
      if (duplicateAskUserIds?.has(toolUseId)) {
        return null
      }
      const todoDiff = toolUseId && todoDiffs ? todoDiffs.get(toolUseId) : null
      return (
        <ToolBlock
          key={i}
          toolUse={block.toolUse}
          toolResult={block.toolResult}
          nestedEvents={block.nestedEvents}
          skillContent={block.skillContent}
          todoDiff={todoDiff}
          blockRelativeTime={blockOffsets[i]}
        />
      )
    }
    if (block.type === BlockType.COMPACTION) {
      return (
        <CompactionBlock
          key={i}
          event={block.event}
          summary={block.summary}
          isCompacting={block.isCompacting}
        />
      )
    }
    return null
  })

  if (!lastSegmentClassName || rendered.length === 0) {
    return <>{rendered}</>
  }

  return (
    <>
      {rendered.slice(0, -1)}
      <div className={lastSegmentClassName}>{rendered[rendered.length - 1]}</div>
    </>
  )
}
