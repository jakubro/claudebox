/** Helpers for opening sessions and workspaces in new browser tabs. */

import { buildTurnSegment } from '../context/utils/sessionRouting'

/**
 * Open a session in a new browser tab via deep-link hash URL.
 *
 * @param {string} workspaceId
 * @param {string} sessionId
 * @param {{ turnId?: string, messageType?: 'user' | 'assistant' }} [options] - Optional jump target appended as `/turns/<role>-<turnId>`.
 */
export function openSessionInNewTab(workspaceId, sessionId, options) {
  const turnSegment = buildTurnSegment(options?.turnId, options?.messageType)
  window.open(
    `${location.pathname}${location.search}#/workspaces/${workspaceId}/sessions/${sessionId}${turnSegment}`,
    '_blank',
  )
}

/** Open a board in a new browser tab via deep-link hash URL. */
export function openBoardInNewTab(workspaceId, boardId) {
  window.open(
    `${location.pathname}${location.search}#/workspaces/${workspaceId}/boards/${boardId}`,
    '_blank',
  )
}

/** Open a workspace in a new browser tab via deep-link hash URL. */
export function openWorkspaceInNewTab(workspaceId) {
  window.open(`${location.pathname}${location.search}#/workspaces/${workspaceId}`, '_blank')
}
