/** Locate the topmost on-screen turn inside a scroll container and choose its role. */

/**
 * Find the first turn whose bottom edge crosses the container's top edge -
 * that's the visually-topmost turn the user is "paused at" - and pick the
 * role half (user message vs assistant message) to anchor the URL segment to.
 *
 * Role choice: prefer `'user'` if the turn's user-message child is itself
 * still visible (its bottom edge is below the container's top); otherwise
 * `'assistant'`. Falls back to `'assistant'` when only the assistant child
 * exists in the topmost turn.
 *
 * @param {HTMLElement} container - The scroll container holding `[data-turn-id]` children.
 * @returns {{turnId: string, role: 'user' | 'assistant'} | null} The topmost turn's id
 *   plus role anchor, or null when no turn is visible or the topmost turn has no id.
 */
export function findTopmostVisibleTurn(container) {
  const containerTop = container.getBoundingClientRect().top
  const turnEls = container.querySelectorAll('[data-turn-id]')
  let topmost = null
  for (const el of turnEls) {
    if (el.getBoundingClientRect().bottom > containerTop) {
      topmost = el
      break
    }
  }
  if (!topmost) {
    return null
  }
  const turnId = topmost.getAttribute('data-turn-id')
  if (!turnId) {
    return null
  }
  const userMsg = topmost.querySelector('[data-testid="message-user"]')
  const assistantMsg = topmost.querySelector('[data-testid="message-assistant"]')
  let role = 'assistant'
  if (userMsg) {
    const userVisible = userMsg.getBoundingClientRect().bottom > containerTop
    if (userVisible || !assistantMsg) {
      role = 'user'
    }
  }
  return { turnId, role }
}
