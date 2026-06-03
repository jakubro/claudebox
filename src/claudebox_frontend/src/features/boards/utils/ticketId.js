/** Extract a display-ready ID from a ticket file path. */

/**
 * Strip the .md extension and return everything before the first hyphen.
 * Falls back to the bare filename when no hyphen is present.
 *
 * @param {string} path - Ticket file path (e.g. "tickets/active/123-foo.md").
 * @returns {string} Display ID (e.g. "123") or the file stem.
 */
export function extractTicketId(path) {
  const filename = path.split('/').pop().replace(/\.md$/, '')
  const dash = filename.indexOf('-')
  return dash >= 0 ? filename.slice(0, dash) : filename
}
