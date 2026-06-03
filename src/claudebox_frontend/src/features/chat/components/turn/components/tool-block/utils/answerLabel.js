/** Pure parser for ExitPlanMode answer labels — no React APIs. */

/**
 * Map an `<answer>...</answer>`-wrapped XML response to a display label.
 *
 * @param {string | null | undefined} message - User-submitted XML string.
 * @returns {'Approved' | 'Rejected' | null}
 */
export function parseAnswerLabel(message) {
  if (!message) {
    return null
  }
  const match = message.match(/<answer>(.*?)<\/answer>/)
  if (!match) {
    return null
  }
  const answer = match[1]
  if (answer === 'Approve') {
    return 'Approved'
  }
  if (answer === 'Reject') {
    return 'Rejected'
  }
  return null
}
