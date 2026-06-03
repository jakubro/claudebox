/** Dropdown open/close state with keyboard and click-outside dismissal. */

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Manage dropdown visibility, toggle, escape-to-close, and click-outside-to-close.
 *
 * Returns `containerRef` for the common case where the trigger and content live
 * in the same wrapper element. For portaled dropdowns, additionally pass
 * `triggerRef` to extend click-outside detection across the trigger and the
 * portal subtree (returned `containerRef` then guards the portal content).
 */
export default function useDropdown(disabled, { triggerRef } = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  const handleToggle = useCallback(() => {
    if (disabled) {
      return
    }
    setIsOpen(prev => !prev)
  }, [disabled])

  const handleKeyDown = useCallback(e => {
    if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }, [])

  // Close on click outside. When triggerRef is provided, allow clicks inside
  // the trigger element too (so the portal subtree + the trigger together
  // count as "inside").
  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleMouseDown(e) {
      const inContainer = containerRef.current?.contains(e.target)
      const inTrigger = triggerRef?.current?.contains(e.target)
      if (!(inContainer || inTrigger)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen, triggerRef])

  return { isOpen, setIsOpen, containerRef, handleToggle, handleKeyDown }
}
