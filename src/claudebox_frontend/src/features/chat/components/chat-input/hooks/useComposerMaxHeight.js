/** Composer max textarea height: 33% of panel height, floored per viewport. */

import { useEffect, useState } from 'react'
import { MOBILE_BREAKPOINT } from '../../../../../config/dimensions'

/**
 * Track the panel-derived max textarea height, shared by the composer and inline reply boxes.
 * @param {object} panelRef - Ref to the chat panel container.
 * @returns {number} The current max height in pixels.
 */
export default function useComposerMaxHeight(panelRef) {
  const [maxHeight, setMaxHeight] = useState(120)

  useEffect(() => {
    const panel = panelRef?.current

    if (!panel) {
      return
    }

    const update = () => {
      const minFloor = window.innerWidth <= MOBILE_BREAKPOINT ? 60 : 120
      setMaxHeight(Math.max(minFloor, Math.floor(panel.clientHeight * 0.33)))
    }

    const observer = new ResizeObserver(update)
    observer.observe(panel)
    update()

    return () => observer.disconnect()
  }, [panelRef])

  return maxHeight
}
