/** Bookmark ID parsing for the turnId:messageType format. */

/**
 * Parse a bookmark ID into turn ID and message type.
 * @param {string} bookmarkId - ID in format "turnId:user" or "turnId:assistant".
 * @returns {{ turnId: string, messageType: string }}
 */
export function parseBookmarkId(bookmarkId) {
  const colonIdx = bookmarkId.lastIndexOf(':')
  return {
    turnId: bookmarkId.slice(0, colonIdx),
    messageType: bookmarkId.slice(colonIdx + 1),
  }
}
