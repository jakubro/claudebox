/** Bookmark ids: `<turnId>:<tail>`, the tail naming the user message, the response, a part or a tool call. */

const KEY = /^[A-Za-z0-9_-]+$/
const PARAGRAPH = /^p-(.+)-(\d+)-(\d+)$/
const TOOL = /^tool-(.+)$/

/**
 * @param {string} bookmarkId - `turnId:user`, `turnId:assistant`, `turnId:p-<eventId>-<segment>-<block>`
 *   or `turnId:tool-<toolUseId>`.
 * @returns {{ turnId: string, messageType: string, role: 'user'|'assistant', target: null|
 *   {kind: 'paragraph', textId: string, block: number}|{kind: 'tool', toolUseId: string} }}
 *   `messageType` is the raw tail, the key toggling and removal rebuild the id from.
 */
export function parseBookmarkId(bookmarkId) {
  const colonIdx = bookmarkId.lastIndexOf(':')
  const messageType = bookmarkId.slice(colonIdx + 1)
  return {
    turnId: bookmarkId.slice(0, colonIdx),
    messageType,
    role: messageType === 'user' ? 'user' : 'assistant',
    target: parseTail(messageType),
  }
}

/** The jump target a part or tool tail names, or null for the user and assistant tails. */
export function parseTail(tail) {
  const paragraph = PARAGRAPH.exec(tail ?? '')
  if (paragraph) {
    return {
      kind: 'paragraph',
      textId: `${paragraph[1]}-${paragraph[2]}`,
      block: Number(paragraph[3]),
    }
  }
  const tool = TOOL.exec(tail ?? '')
  return tool ? { kind: 'tool', toolUseId: tool[1] } : null
}

/** Tail for top-level block `block` of text segment `segment` of event `eventId`; null when unkeyable. */
export function paragraphBookmarkKey(eventId, segment, block) {
  const key = `p-${eventId}-${segment}-${block}`
  return eventId && KEY.test(key) ? key : null
}

/** Tail for the tool call `toolUseId`; null when its id cannot be a key. */
export function toolBookmarkKey(toolUseId) {
  const key = `tool-${toolUseId}`
  return toolUseId && KEY.test(key) ? key : null
}

/** Return navigation options landing on tool call `toolUseId` of turn `turnId`. */
export function toolJumpOptions(turnId, toolUseId) {
  return { turnId, messageType: 'assistant', target: toolBookmarkKey(toolUseId) }
}

/** Navigation options for a bookmark: its turn and role, plus the part a part bookmark names. */
export function bookmarkJumpOptions(turnId, messageType) {
  return parseTail(messageType)
    ? { turnId, messageType: 'assistant', target: messageType }
    : { turnId, messageType }
}
