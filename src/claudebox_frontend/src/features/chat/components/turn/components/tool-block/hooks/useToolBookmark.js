/** Bookmark control for a tool call the agent made itself, or null where none applies. */

import { toolBookmarkKey } from '../../../../../../../utils/bookmarkIds'
import { useTurn } from '../../../hooks/useTurn'

/**
 * Only the agent's own calls are bookmarkable; a subagent's carry their parent's tool-use id.
 * @param {object} toolUse - The call's tool_use event
 * @param {function(): string} previewOf - The call's collapsed header line, its bookmark preview
 * @returns {{active: boolean, onToggle: function}|null}
 */
export default function useToolBookmark(toolUse, previewOf) {
  const { turnId, bookmarkedParts, onToggleBookmark } = useTurn()
  const key =
    turnId && onToggleBookmark && !toolUse?.parent_tool_use_id
      ? toolBookmarkKey(toolUse?.tool_use_id)
      : null
  if (!key) {
    return null
  }
  return {
    active: !!bookmarkedParts?.has(key),
    onToggle: () => onToggleBookmark(turnId, key, previewOf()),
  }
}
