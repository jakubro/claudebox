/** Drift between a session's live values and the starting values its bundle declared. */

/**
 * Keys the bundle declared whose live value differs. A value the session has not reported yet
 * (absent or null) is not drift - a new session reports its values only after it starts.
 *
 * @param {object|null} declared - Starting values the bundle set, keyed as the session reports.
 * @param {object|null} sessionData - The session's current values.
 * @returns {string[]}
 */
export function driftedKeys(declared, sessionData) {
  if (!(declared && sessionData)) {
    return []
  }
  return Object.keys(declared).filter(
    key => sessionData[key] != null && sessionData[key] !== declared[key],
  )
}
