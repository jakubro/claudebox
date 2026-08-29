/** Helpers for opening sessions and workspaces in new browser tabs. */

import { buildTurnSegment } from '../context/utils/sessionRouting'

/**
 * Build the in-app hash route for a session - for `window.open` and for a plain `<a>` that must
 * resolve to the same route without scripted navigation, so no browser treats it as a popup.
 * @param {string} workspaceId
 * @param {string} sessionId
 * @param {{ turnId?: string, messageType?: 'user' | 'assistant' }} [options] - Optional jump
 *   target appended as `/turns/<role>-<turnId>`.
 */
export function buildSessionHref(workspaceId, sessionId, options) {
  const turnSegment = buildTurnSegment(options?.turnId, options?.messageType)
  return `${location.pathname}${location.search}#/workspaces/${workspaceId}/sessions/${sessionId}${turnSegment}`
}

/**
 * @param {string} workspaceId
 * @param {string} sessionId
 * @param {{ turnId?: string, messageType?: 'user' | 'assistant' }} [options] - Optional jump
 *   target appended as `/turns/<role>-<turnId>`.
 * @returns {Window|null} The opened window, or null when the browser blocked the popup.
 */
export function openSessionInNewTab(workspaceId, sessionId, options) {
  return window.open(buildSessionHref(workspaceId, sessionId, options), '_blank')
}

export function openBoardInNewTab(workspaceId, boardId) {
  window.open(
    `${location.pathname}${location.search}#/workspaces/${workspaceId}/boards/${boardId}`,
    '_blank',
  )
}

export function openWorkspaceInNewTab(workspaceId) {
  window.open(`${location.pathname}${location.search}#/workspaces/${workspaceId}`, '_blank')
}
