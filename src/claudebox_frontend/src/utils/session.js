/** Session-related formatting helpers shared across header, sessions panel, and footer. */

/**
 * Format the unified "Session directory" tooltip used by the session header strip's
 * name button, each sessions-panel session item, and the footer session entry.
 * Falls back to an em-dash when no session directory is set.
 *
 * @param {string|null|undefined} sessionDir - Absolute session directory path.
 * @returns {string}
 */
export function formatSessionDirTooltip(sessionDir) {
  return `Session directory - ${sessionDir || '-'}`
}
