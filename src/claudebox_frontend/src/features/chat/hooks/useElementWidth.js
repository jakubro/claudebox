/** Live-measured element width via ResizeObserver, for width-driven layout decisions. */

import { useEffect, useState } from 'react'

/** Current `clientWidth` of the observed element, or `null` before the first measurement. */
export default function useElementWidth(elementRef) {
  const [width, setWidth] = useState(null)

  useEffect(() => {
    const el = elementRef?.current
    if (!el) {
      return undefined
    }

    const update = () => setWidth(el.clientWidth)
    const observer = new ResizeObserver(update)
    observer.observe(el)
    update()

    return () => observer.disconnect()
  }, [elementRef])

  return width
}
