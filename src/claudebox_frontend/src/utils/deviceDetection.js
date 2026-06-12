/** Browser-feature mobile detection - extracted from useIsMobile.js, no React APIs. */

export const TOUCH_PRIMARY_MEDIA_QUERY = '(pointer: coarse) and (hover: none)'
const UA_RE = /Mobi|Android|iPhone/i

/** Return true when the device is touch-primary (mobile / tablet), false on desktop. */
export function detectTouchPrimary() {
  if (typeof window === 'undefined') {
    return false
  }
  if (window.matchMedia(TOUCH_PRIMARY_MEDIA_QUERY).matches) {
    return true
  }
  return UA_RE.test(navigator.userAgent || '')
}
