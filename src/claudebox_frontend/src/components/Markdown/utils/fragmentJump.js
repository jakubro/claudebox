/** Same-message fragment links: resolve `#target` inside the message the link sits in, and jump there. */

import { scrollAndHighlight } from '../../../utils/scroll'

const ID_PREFIX = 'user-content-'

/**
 * Scroll to and flash the element `href` names within the link's own message; a target outside it,
 * or none, leaves everything as it is.
 * @param {HTMLElement} link - The clicked anchor
 * @param {string} href - Its `#fragment` href
 */
export function jumpToFragment(link, href) {
  const fragment = decodeURIComponent(href.slice(1))
  const id = fragment.startsWith(ID_PREFIX) ? fragment : `${ID_PREFIX}${fragment}`
  const root = link.closest('[data-md-block]')?.parentElement
  const quoted = CSS.escape(id)
  const target = root?.querySelector(`[id="${quoted}"], [name="${quoted}"]`)
  const scroller = target && scrollableAncestor(target)
  if (scroller) {
    scrollAndHighlight(scroller, target)
  }
}

function scrollableAncestor(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
  }
  return document.scrollingElement
}
