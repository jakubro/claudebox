/** Session-related formatting helpers shared across header, sessions panel, and footer. */

/**
 * @param {string|null|undefined} sessionDir - Absolute session directory path.
 * @returns {string}
 */
export function formatSessionDirTooltip(sessionDir) {
  return `Session directory - ${sessionDir || '-'}`
}
