/** Detect mobile via input modality (pointer:coarse + hover:none) with UA fallback. */

import { useEffect, useState } from 'react'
import { detectTouchPrimary, TOUCH_PRIMARY_MEDIA_QUERY } from '../utils/deviceDetection'

/** Return true when the device is touch-primary (mobile / tablet), false on desktop. */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(detectTouchPrimary)

  useEffect(() => {
    const mql = window.matchMedia(TOUCH_PRIMARY_MEDIA_QUERY)
    const handler = () => setIsMobile(detectTouchPrimary())
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isMobile
}
