/** Locate the topmost on-screen turn inside a scroll container and choose its role. */

/**
 * Prefers `'user'` when the topmost turn's user-message child is still visible (its bottom edge
 * is below the container's top); falls back to `'assistant'` otherwise, including when the turn
 * has no user child.
 *
 * @param {HTMLElement} container - The scroll container holding `[data-turn-id]` children.
 * @returns {{turnId: string, role: 'user' | 'assistant'} | null} Null when no turn is visible or
 *   the topmost turn has no id.
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
