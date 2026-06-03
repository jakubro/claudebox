/** Leading slash-command detection for the chat textarea. */

/**
 * Locate a leading slash command in textarea content.
 *
 * @param {string} value - Textarea value.
 * @returns {{token: string, end: number}|null} Token (e.g. `/scope`) and index past it, or null.
 */
export function leadingCommand(value) {
  const m = value.match(/^\/(\S*)/)
  if (!m) {
    return null
  }
  return { token: m[0], end: m[0].length }
}
