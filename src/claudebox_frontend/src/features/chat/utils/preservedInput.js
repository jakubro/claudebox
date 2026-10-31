/** The composer text kept in this tab after a send found its container gone, with its owner. */

const KEY = '_cb_preserved_input'

/** Keep `content` for the session named by `owner` (an owner tag). */
export function preserveInput(owner, content) {
  sessionStorage.setItem(KEY, JSON.stringify({ owner, content }))
}

/** The kept `{owner, content}`, or null. */
export function readPreservedInput() {
  try {
    const stored = sessionStorage.getItem(KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function clearPreservedInput() {
  sessionStorage.removeItem(KEY)
}
