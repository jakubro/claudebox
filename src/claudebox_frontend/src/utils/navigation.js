/** Helpers for opening sessions and workspaces in new browser tabs. */

import { buildTurnSegment } from '../context/utils/sessionRouting'

/**
 * @param {string} workspaceId
 * @param {string} sessionId
 * @param {{ turnId?: string, messageType?: 'user' | 'assistant' }} [options] - Optional jump
 *   target appended as `/turns/<role>-<turnId>`.
 */
export function openSessionInNewTab(workspaceId, sessionId, options) {
  const turnSegment = buildTurnSegment(options?.turnId, options?.messageType)
  window.open(
    `${location.pathname}${location.search}#/workspaces/${workspaceId}/sessions/${sessionId}${turnSegment}`,
    '_blank',
  )
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
