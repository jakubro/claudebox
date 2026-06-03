/** Compute fixed-position coordinates for a dropdown anchored to a trigger element. */

import { useEffect, useState } from 'react'

// audit-ignore: misplaced-constant
const DEFAULT_MARGIN = 2
const VIEWPORT_PAD = 4

/**
 * Position a dropdown anchored to a trigger element. Recomputes on scroll,
 * resize, and trigger-container resize. Flips to top when there's no room
 * below the trigger, and clamps to the viewport horizontally.
 *
 * @param {object} options
 * @param {object} options.triggerRef - Ref to the trigger (e.g., chevron) element.
 * @param {object} options.contentRef - Ref to the dropdown content element.
 * @param {boolean} options.isOpen - Whether the dropdown is open.
 * @param {string} [options.alignTo='left'] - Trigger edge to align dropdown's left to.
 * @param {number} [options.margin=2] - Gap between trigger and dropdown.
 * @returns {{top: number|null, left: number|null, side: 'bottom'|'top'}}
 */
export default function useDropdownPosition({
  triggerRef,
  contentRef,
  isOpen,
  alignTo = 'left',
  margin = DEFAULT_MARGIN,
}) {
  const [position, setPosition] = useState({ top: null, left: null, side: 'bottom' })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    let raf = 0

    function recompute() {
      const trigger = triggerRef.current
      const content = contentRef.current
      if (!trigger) {
        return
      }
      const rect = trigger.getBoundingClientRect()
      const dropdownH = content?.offsetHeight ?? 0
      const dropdownW = content?.offsetWidth ?? 0
      const spaceBelow = window.innerHeight - rect.bottom

      const side = dropdownH > 0 && spaceBelow < dropdownH ? 'top' : 'bottom'
      const top = side === 'bottom' ? rect.bottom + margin : rect.top - dropdownH - margin

      const rawLeft = alignTo === 'right' ? rect.right - dropdownW : rect.left
      const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - dropdownW - VIEWPORT_PAD)
      const left = Math.min(Math.max(VIEWPORT_PAD, rawLeft), maxLeft)

      setPosition({ top, left, side })
    }

    function schedule() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(recompute)
    }

    recompute()

    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)

    let observer = null
    const trigger = triggerRef.current
    if (trigger?.closest && typeof ResizeObserver !== 'undefined') {
      const panel = trigger.closest('[data-testid="panel-sessions"]')
      if (panel) {
        observer = new ResizeObserver(schedule)
        observer.observe(panel)
      }
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      if (observer) {
        observer.disconnect()
      }
    }
  }, [isOpen, triggerRef, contentRef, alignTo, margin])

  return position
}
