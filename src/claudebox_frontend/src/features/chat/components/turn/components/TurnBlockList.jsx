/** Render the block list for a conversation turn. */

import CopyButton from '../../../../../components/CopyButton.jsx'
import Markdown from '../../../../../components/Markdown'
import { BlockType } from '../../../../../config/schema'
import { groupBlocks } from '../utils/groupBlocks'
import CompactionBlock from './CompactionBlock'
import LocalCommandBlock from './LocalCommandBlock'
import SystemReminders from './SystemReminders'
import ThinkingBlock from './ThinkingBlock'
import ToolBlock from './tool-block'
import TodosGroup from './tool-block/components/tool-block-expanded-content/components/TodosGroup'
import { extractSystemReminders } from './tool-block/utils/toolResultFormatters'

/**
 * Render the block list for a conversation turn.
 * Consumes TurnContext implicitly through ToolBlock.
 * Consecutive task-list tool blocks within one subagent partition collapse into
 * a single always-expanded TodosGroup; non-list tools pass through unchanged
 * and break runs.
 * @param {Object} props
 * @param {Array} props.blocks - Processed event blocks.
 * @param {Array} props.blockOffsets - Precomputed timing offsets per block.
 * @param {Set} [props.duplicateAskUserIds] - Cross-turn duplicate AskUserQuestion IDs to hide.
 * @param {Map} [props.todoDiffs] - Todo diffs for todoDiff lookup.
 * @returns {JSX.Element|null}
 */
export default function TurnBlockList({
  blocks,
  blockOffsets,
  duplicateAskUserIds = null,
  todoDiffs = null,
}) {
  const segments = groupBlocks(blocks)
  return (
    <>
      {segments.map((segment, segIdx) => {
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
        if (block.type === BlockType.INTERRUPT) {
          return (
            <div key={i} className="interrupt-indicator">
              <span className="interrupt-dash">──</span>
              <span>Interrupted</span>
              <span className="interrupt-dash">──</span>
            </div>
          )
        }
        return null
      })}
    </>
  )
}
