/** Panel that gathers a turn's scattered read-only tool calls into one collapsed group. */

import { useState } from 'react'
import { useTurn } from '../../../../../hooks/useTurn'
import ToolBlock from '../../../ToolBlock'
import ToolBlockHeader from '../../ToolBlockHeader'
import NestedContent from './NestedContent'
import { formatLookupsSummary } from './utils/formatLookupsSummary'

// Synthetic chrome host, not a real tool - no pending/awaiting/error states. Mirrors TodosGroup's INERT_STATUS.
const INERT_STATUS = {
  isPending: false,
  isAwaitingAnswer: false,
  wasAnswered: false,
  isError: false,
}

/**
 * Gathers a turn's read-only tool calls (Read, Grep, Glob, ...) into rows that expand independently via
 * `ToolBlock` recursively; opens collapsed, unlike TodosGroup.
 *
 * @param {Array<{block: object, index: number}>} props.entries - Gathered segments, in call order.
 * @param {Array<number|null>} props.blockOffsets - Turn-wide timing offsets, indexed like `entries[].index`.
 */
export default function LookupsGroup({ entries, blockOffsets }) {
  const { todoDiffs } = useTurn()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="tool-block" data-testid="lookups-group">
      <ToolBlockHeader
        header="Lookups"
        toolName="Lookups"
        summary={formatLookupsSummary(entries)}
        hasExpandable={true}
        onToggle={() => setExpanded(prev => !prev)}
        toolStatus={INERT_STATUS}
      />
      {expanded && (
        <div className="tool-expanded-content">
          <div className="lookups-group-rows" data-testid="lookups-group-rows">
            <NestedContent className="tool-nested">
              {entries.map(({ block, index }) => {
                const toolUseId = block.toolUse?.tool_use_id
                const todoDiff = toolUseId && todoDiffs ? todoDiffs.get(toolUseId) : null
                return (
                  <ToolBlock
                    key={index}
                    toolUse={block.toolUse}
                    toolResult={block.toolResult}
                    nestedEvents={block.nestedEvents}
                    skillContent={block.skillContent}
                    todoDiff={todoDiff}
                    blockRelativeTime={blockOffsets[index]}
                    nested
                  />
                )
              })}
            </NestedContent>
          </div>
        </div>
      )}
    </div>
  )
}
