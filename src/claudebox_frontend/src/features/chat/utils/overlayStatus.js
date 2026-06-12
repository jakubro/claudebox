/** Pure overlay-status text builder - extracted from ChatPanel.jsx, no React APIs. */

/**
 * Resolve the status line shown below the chat overlay's progress bar.
 *
 * @param {{
 *   isCreating: boolean,
 *   progressMessage: string | null | undefined,
 *   isReplaying: boolean,
 *   replayProgress: number,
 *   replayTotal: number,
 *   isResuming: boolean,
 * }} params
 * @returns {string | null}
 */
export function getOverlayStatusText({
  isCreating,
  progressMessage,
  isReplaying,
  replayProgress,
  replayTotal,
  isResuming,
}) {
  if (isCreating) {
    return progressMessage ? `${progressMessage}…` : null
  }
  if (isReplaying) {
    return `Replaying events (${replayProgress}/${replayTotal})…`
  }
  if (isResuming) {
    return (progressMessage && `${progressMessage}…`) || 'Loading session…'
  }
  return null
}
