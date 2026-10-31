/** Where a bookmark lands inside its turn: a part of the response, a tool call, or a whole message. */

import { EventSubtype, normalizeToolName, ToolName } from '../config/schema'

/**
 * The element a bookmark lands on inside `turnEl`, or null while its part is not drawn (a
 * collapsed turn, a block not yet mounted) - the caller falls back to the response itself.
 * @param {HTMLElement} turnEl - The turn's container
 * @param {'user'|'assistant'} role
 * @param {null|{kind: 'paragraph', textId: string, block: number}|{kind: 'tool', toolUseId: string}} target
 */
export function resolveBookmarkTarget(turnEl, role, target) {
  const response = turnEl.querySelector('[data-testid="message-assistant"]')
  if (target?.kind === 'paragraph') {
    return visible(
      response?.querySelector(
        `.turn-text[data-text-id="${CSS.escape(target.textId)}"] > [data-md-block="${target.block}"]`,
      ),
    )
  }
  if (target?.kind === 'tool') {
    return visible(response?.querySelector(`[data-tool-use-id="${CSS.escape(target.toolUseId)}"]`))
  }
  if (role === 'user') {
    return turnEl.querySelector('[data-testid="message-user"]') ?? response ?? turnEl
  }
  return response ?? turnEl
}

function visible(el) {
  return el && !el.closest('.turn-content-collapsed') ? el : null
}

/** Whether `toolUseId` is a shell call of turn `turnId` - the calls the terminal column shows. */
export function isShellCallInTurn(turns, turnId, toolUseId) {
  return !!turns
    .find(t => t.turn_id === turnId)
    ?.events.some(
      e =>
        e.subtype === EventSubtype.TOOL_USE &&
        e.tool_use_id === toolUseId &&
        normalizeToolName(e.content) === ToolName.BASH,
    )
}
