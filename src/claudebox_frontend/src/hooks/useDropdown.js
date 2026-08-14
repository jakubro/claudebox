/** Dropdown open/close state with keyboard and click-outside dismissal. */

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Returns `containerRef` for the common case where trigger and content share a wrapper. Portaled
 * dropdowns should also pass `triggerRef`, extending click-outside detection to the portal subtree.
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

  // Close on click outside; triggerRef clicks also count as "inside" for portaled dropdowns.
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
