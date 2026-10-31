/** Keys for the daemon stream's per-board change counts. */

/** Key for `boardChanges`: board ids are unique only within a workspace. */
export function boardChangeKey(workspaceId, boardId) {
  return `${workspaceId}/${boardId}`
}
